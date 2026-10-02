"""Account-serialized source and pending-obligation gates for a new replay entry."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope
from .lifecycle_protection_contracts import ProtectionObligation
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .lifecycle_source_replay import materialize_run_events


async def require_replay_entry_checkpoint(conn, scope: FinanceScope,
                                          manifest: SimulationRunManifest,
                                          run: dict, instrument_version_id: str,
                                          action: str) -> None:
    """Caller holds account/run locks; no new risk amid unfurled source facts."""
    params = _run_params(scope, manifest.run_id)
    if manifest.scope != scope or run["manifest_hash"] != manifest.manifest_hash:
        raise FinanceError("replay admission run identity changed")
    await materialize_run_events(conn, manifest)
    unfurled = (await conn.execute(text("""
        SELECT 1 FROM simulation_order_events e LEFT JOIN simulation_event_folds f
          ON f.environment=e.environment AND f.scope_id=e.scope_id
          AND f.strategy_account_id=e.strategy_account_id AND f.run_id=e.run_id
          AND f.event_hash=e.event_hash
        WHERE e.environment=:environment AND e.scope_id=:scope_id
          AND e.strategy_account_id=:strategy_account_id AND e.run_id=:run_id
          AND e.simulation_cursor_at<=:cursor AND f.event_hash IS NULL LIMIT 1
    """), {**params, "cursor": run["replay_cursor_at"]})).first()
    if unfurled:
        raise FinanceError("unfolded replay source blocks a new entry")
    unsettled_position = (await conn.execute(text("""
        SELECT 1 FROM simulation_positions WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id AND reconciliation_state!='clean' LIMIT 1
    """), params)).first()
    if unsettled_position:
        raise FinanceError("position lacks a clean replay checkpoint")
    if action not in {"spot_buy", "perp_open", "perp_increase"}:
        return
    protections = (await conn.execute(text("""
        SELECT run_id,protection_order_id,instrument_version_id,status,
          originating_order_id,intended_json FROM simulation_protections
        WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND resolution_hash IS NULL
          AND status IN ('intended','requested','confirmed','rejected','uncertain')
    """), params)).mappings().all()
    if protections:
        policy = manifest.protection_policy
        if policy is None or not policy.allow_increases_before_deadline:
            raise FinanceError("unresolved protection obligation blocks new exposure")
        for protection in protections:
            if protection["status"] != "intended" or \
                    protection["run_id"] != manifest.run_id or \
                    protection["instrument_version_id"] != instrument_version_id or \
                    protection["intended_json"] is None:
                raise FinanceError("non-intended or cross-scope protection blocks increase")
            obligation = ProtectionObligation.model_validate_json(
                json.dumps(protection["intended_json"]))
            if obligation.manifest_hash != manifest.manifest_hash or \
                    obligation.protection_order_id != protection["protection_order_id"] or \
                    obligation.instrument_version_id != instrument_version_id or \
                    obligation.deadline_at_cursor <= run["replay_cursor_at"]:
                raise FinanceError("protection origin or earliest deadline blocks increase")
        attempted = (await conn.execute(text("""
            SELECT 1 FROM simulation_orders o JOIN simulation_protections p
              ON p.environment=o.environment AND p.scope_id=o.scope_id
              AND p.strategy_account_id=o.strategy_account_id AND p.run_id=o.run_id
              AND (o.order_id=p.protection_order_id OR
                   o.permit_json->>'protection_order_id'=p.protection_order_id)
            WHERE p.environment=:environment AND p.scope_id=:scope_id
              AND p.strategy_account_id=:strategy_account_id
              AND p.status='intended' AND p.resolution_hash IS NULL LIMIT 1
        """), params)).first()
        if attempted:
            raise FinanceError("submitted protective reduction blocks new increase")
        financial = (await conn.execute(text("""
            SELECT a.revision,a.observation_snapshot_hash,a.reconciliation_state,
              c.result,c.observation_snapshot_hash AS checkpoint_snapshot,
              d.snapshot_hash AS derived_snapshot
            FROM finance_accounts a
            LEFT JOIN finance_reconciliation_checkpoints c ON
              c.environment=a.environment AND c.scope_id=a.scope_id AND
              c.strategy_account_id=a.strategy_account_id AND
              c.account_revision=a.revision
            LEFT JOIN simulation_derived_snapshots d ON
              d.environment=a.environment AND d.scope_id=a.scope_id AND
              d.strategy_account_id=a.strategy_account_id AND d.run_id=:run_id AND
              d.snapshot_hash=a.observation_snapshot_hash
            WHERE a.environment=:environment AND a.scope_id=:scope_id
              AND a.strategy_account_id=:strategy_account_id
        """), params)).mappings().first()
        if financial is None or financial["reconciliation_state"] != "clean" or \
                financial["result"] != "clean" or \
                financial["checkpoint_snapshot"] != financial["observation_snapshot_hash"] or \
                financial["derived_snapshot"] != financial["observation_snapshot_hash"]:
            raise FinanceError("prior exposure lacks clean derived checkpoint")
        for protection in protections:
            origin = (await conn.execute(text("""
                SELECT o.status,o.terminal_event_hash,r.status AS hold_status,
                  r.resolution_proof_hash,z.resolution_hash,
                  f.event_hash AS folded_terminal
                FROM simulation_orders o JOIN finance_reservations r ON
                  r.environment=o.environment AND r.scope_id=o.scope_id AND
                  r.strategy_account_id=o.strategy_account_id AND
                  r.reservation_id=o.reservation_id
                LEFT JOIN simulation_reservation_resolutions z ON
                  z.environment=r.environment AND z.scope_id=r.scope_id AND
                  z.strategy_account_id=r.strategy_account_id AND
                  z.reservation_id=r.reservation_id AND z.run_id=o.run_id
                LEFT JOIN simulation_event_folds f ON
                  f.environment=o.environment AND f.scope_id=o.scope_id AND
                  f.strategy_account_id=o.strategy_account_id AND f.run_id=o.run_id AND
                  f.event_hash=o.terminal_event_hash
                WHERE o.environment=:environment AND o.scope_id=:scope_id
                  AND o.strategy_account_id=:strategy_account_id AND o.run_id=:run_id
                  AND o.order_id=:order_id
            """), {**params, "order_id": protection["originating_order_id"]}
            )).mappings().first()
            if origin is None or origin["status"] not in {"filled", "cancelled"} or \
                    origin["hold_status"] != "settled" or \
                    origin["resolution_hash"] is None or \
                    origin["resolution_proof_hash"] != origin["resolution_hash"] or \
                    origin["terminal_event_hash"] is None or \
                    origin["terminal_event_hash"] != origin["folded_terminal"]:
                raise FinanceError("prior increasing order lacks final financial disposition")
    prior = (await conn.execute(text("""
        SELECT r.status AS reservation_status,o.status AS order_status
        FROM finance_reservations r JOIN simulation_intents i
          ON i.environment=r.environment AND i.scope_id=r.scope_id
          AND i.strategy_account_id=r.strategy_account_id
          AND i.intent_id=r.intent_id
        LEFT JOIN simulation_orders o
          ON o.environment=i.environment AND o.scope_id=i.scope_id
          AND o.strategy_account_id=i.strategy_account_id AND o.run_id=i.run_id
          AND o.reservation_id=r.reservation_id
        WHERE r.environment=:environment AND r.scope_id=:scope_id
          AND r.strategy_account_id=:strategy_account_id
          AND i.intent_json->>'instrument_version_id'=:instrument
          AND i.intent_json->>'action' IN ('spot_buy','perp_open','perp_increase')
    """), {**params, "instrument": instrument_version_id})).mappings().all()
    if any(row["reservation_status"] in {"reserved", "submitted", "uncertain"} or
           row["order_status"] is not None and
           row["order_status"] not in {"filled", "cancelled", "rejected"}
           for row in prior):
        raise FinanceError("earlier increasing order remains economically unresolved")
