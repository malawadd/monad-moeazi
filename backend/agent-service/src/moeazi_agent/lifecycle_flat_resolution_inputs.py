"""Reconstruct flatness from source before releasing protection obligations."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, _digest, db_native_int, native_int
from .lifecycle_checkpoint_verify import verify_replay_checkpoint
from .lifecycle_control_proofs import terminal_order_fact
from .lifecycle_position_math_contracts import PositionArithmeticState
from .lifecycle_protection_contracts import ProtectionObligation
from .lifecycle_run_store import _run_params


async def flat_resolution_inputs(conn, scope, manifest, run, account, instrument):
    """Return exact proof inventory or None while any known obligation remains."""
    params = {**_run_params(scope, manifest.run_id), "instrument": instrument}
    if account["reconciliation_state"] != "clean":
        return None
    rows = (await conn.execute(text("""
        SELECT * FROM simulation_positions WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND instrument_version_id=:instrument ORDER BY run_id,location_id
    """), params)).mappings().all()
    if not rows or any(row["run_id"] != manifest.run_id for row in rows):
        return None
    positions = []
    for row in rows:
        if row["reconciliation_state"] != "clean" or row["arithmetic_state_json"] is None:
            return None
        state = PositionArithmeticState.model_validate_json(json.dumps(row["arithmetic_state_json"]))
        digest = _digest("moeazi-position-arithmetic-v1", state.model_dump(mode="json"))
        if state.scope != scope or state.run_id != manifest.run_id or \
                state.instrument_version_id != instrument or state.location_id != row["location_id"] or \
                digest != row["arithmetic_state_hash"] or \
                native_int(state.signed_quantity_units) != db_native_int(row["signed_exposure_units"]) or \
                native_int(state.collateral_units) != db_native_int(row["collateral_units"]):
            raise FinanceError("flat resolution position identity differs")
        if any(native_int(value) for value in (state.signed_quantity_units,
                state.margin_reserved_units, state.collateral_units)):
            return None
        positions.append({"locationId": row["location_id"], "positionRevision": row["revision"],
                          "positionStateHash": digest})
    pending = (await conn.execute(text("""
        SELECT EXISTS(SELECT 1 FROM finance_pending_events WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id) OR
          EXISTS(SELECT 1 FROM simulation_intents i JOIN finance_reservations h
            USING(environment,scope_id,strategy_account_id,intent_id)
            WHERE i.environment=:environment AND i.scope_id=:scope_id
              AND i.strategy_account_id=:strategy_account_id
              AND i.intent_json->>'instrument_version_id'=:instrument
              AND h.status NOT IN ('settled','released'))
    """), params)).scalar_one()
    if pending:
        return None
    orders = (await conn.execute(text("""
        SELECT * FROM simulation_orders WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND instrument_version_id=:instrument
          ORDER BY run_id,order_ordinal
    """), params)).mappings().all()
    if not orders or any(row["run_id"] != manifest.run_id or
                         row["status"] not in {"filled", "cancelled", "rejected"} for row in orders):
        return None
    proofs = []
    for order in orders:
        fact = await terminal_order_fact(conn, {**params, "manifest_hash": manifest.manifest_hash,
            "cursor": run["replay_cursor_at"]}, order)
        proof = (await conn.execute(text("""
            SELECT * FROM simulation_reservation_resolutions WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
              AND run_id=:run_id AND order_id=:order
        """), {**params, "order": order["order_id"]})).mappings().first()
        if fact is None or proof is None:
            return None
        if fact.event_hash != order["terminal_event_hash"] or \
                proof["terminal_event_hash"] != fact.event_hash or \
                proof["reservation_id"] != order["reservation_id"] or \
                proof["permit_hash"] != order["permit_hash"] or \
                proof["terminal_order_status"] != order["status"] or \
                proof["cumulative_filled_units"] != order["cumulative_filled_units"]:
            raise FinanceError("flat resolution terminal reservation proof differs")
        proofs.append(proof["resolution_hash"])
    oracle, _ = await verify_replay_checkpoint(conn, scope, manifest, run, account)
    checkpoint = (await conn.execute(text("""
        SELECT d.source_root,d.journal_root,d.position_root,d.replay_cursor_at,
          c.result,c.reason,c.journal_root_hash,c.observation_snapshot_hash
        FROM simulation_derived_snapshots d JOIN finance_reconciliation_checkpoints c
          USING(environment,scope_id,strategy_account_id)
        WHERE d.environment=:environment AND d.scope_id=:scope_id
          AND d.strategy_account_id=:strategy_account_id AND d.run_id=:run_id
          AND d.manifest_hash=:manifest AND d.snapshot_hash=:snapshot
          AND c.account_revision=:revision
    """), {**params, "manifest": manifest.manifest_hash,
           "snapshot": account["observation_snapshot_hash"], "revision": account["revision"]})).mappings().first()
    if checkpoint is None or checkpoint["source_root"] != oracle.source_root or \
            checkpoint["journal_root"] != oracle.journal_root or \
            checkpoint["position_root"] != oracle.position_root or \
            checkpoint["journal_root_hash"] != oracle.journal_root or \
            checkpoint["observation_snapshot_hash"] != account["observation_snapshot_hash"] or \
            checkpoint["result"] != "clean" or checkpoint["reason"] != account["reconciliation_reason"] or \
            checkpoint["replay_cursor_at"] != run["replay_cursor_at"]:
        raise FinanceError("flat resolution lacks exact current reconstructed checkpoint")
    obligations = (await conn.execute(text("""
        SELECT * FROM simulation_protections WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND instrument_version_id=:instrument AND resolution_hash IS NULL ORDER BY intended_hash
    """), params)).mappings().all()
    for row in obligations:
        if row["intended_json"] is None:
            raise FinanceError("legacy protection lacks source-bound resolution identity")
        obligation = ProtectionObligation.model_validate_json(json.dumps(row["intended_json"]))
        if obligation.scope != scope or obligation.run_id != manifest.run_id or \
                obligation.manifest_hash != manifest.manifest_hash or \
                obligation.instrument_version_id != instrument or \
                obligation.location_id != row["location_id"] or \
                obligation.intended_hash != row["intended_hash"] or \
                obligation.originating_event_hash != row["originating_event_hash"] or \
                obligation.protection_order_id != row["protection_order_id"]:
            raise FinanceError("flat resolution obligation origin differs")
    return {"positions": positions, "obligationIntendedHashes": [r["intended_hash"] for r in obligations],
            "reservationResolutionHashes": sorted(proofs), "sourceRoot": oracle.source_root,
            "journalRoot": oracle.journal_root, "positionRoot": oracle.position_root}
