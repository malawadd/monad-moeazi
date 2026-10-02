"""Fenced, idempotent advancement through a frozen simulation source corpus."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest, _hash
from .lifecycle_checkpoint_verify import verify_replay_checkpoint
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .lifecycle_source_replay import next_due_event_cursor
from .lifecycle_protection_deadlines import next_protection_deadline


def _receipt(previous, following, manifest_hash, source_root,
             account_snapshot_hash, revision) -> str:
    return _digest("moeazi-replay-cursor-step-v1", {
        "manifestHash": manifest_hash,
        "previousCursorAt": previous.isoformat(),
        "nextCursorAt": following.isoformat(),
        "sourceRoot": source_root,
        "accountSnapshotHash": account_snapshot_hash,
        "projectionRevision": revision})


async def terminal_replay_ready(conn, params: dict, run: dict,
                                account: dict) -> bool:
    """An end-of-horizon step is allowed only after every run obligation clears."""
    if not run["entries_stopped"] or account["reconciliation_state"] != "clean":
        return False
    pending = (await conn.execute(text("""
        SELECT
          EXISTS(SELECT 1 FROM simulation_entry_requests
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
              AND status NOT IN ('rejected','completed','submission_possible'))
          OR EXISTS(SELECT 1 FROM simulation_orders o
            JOIN finance_reservations r ON r.environment=o.environment
              AND r.scope_id=o.scope_id AND r.strategy_account_id=o.strategy_account_id
              AND r.reservation_id=o.reservation_id
            WHERE o.environment=:environment AND o.scope_id=:scope_id
              AND o.strategy_account_id=:strategy_account_id AND o.run_id=:run_id
              AND (o.status NOT IN ('filled','cancelled','rejected') OR
                   r.status NOT IN ('settled','released')))
          OR EXISTS(SELECT 1 FROM simulation_positions
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
              AND (signed_exposure_units<>0 OR pending_obligations OR
                   reconciliation_state<>'clean'))
          OR EXISTS(SELECT 1 FROM simulation_protections
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
              AND resolution_hash IS NULL
              AND status IN ('intended','requested','confirmed','rejected','uncertain'))
          OR EXISTS(SELECT 1 FROM simulation_commands c
            WHERE c.environment=:environment AND c.scope_id=:scope_id
              AND c.strategy_account_id=:strategy_account_id AND c.run_id=:run_id
              AND c.outcome='applied' AND c.operation IN ('request_cancel','request_close')
              AND NOT EXISTS(SELECT 1 FROM simulation_control_processing p
                WHERE p.environment=c.environment AND p.scope_id=c.scope_id
                  AND p.strategy_account_id=c.strategy_account_id AND p.run_id=c.run_id
                  AND p.command_id=c.command_id AND p.processing_kind='resolved'))
    """), params)).scalar_one()
    return not pending


class LifecycleReplayCursorMixin:
    async def advance_replay_cursor(self, scope: FinanceScope, run_id: str,
                                    manifest_hash: str, *, worker_id: str,
                                    command_id: str) -> dict:
        """Only the next modeled fact determines the historical replay timestamp."""
        _hash(manifest_hash)
        if scope.environment != "experiment" or not worker_id or not command_id:
            raise FinanceError("replay cursor needs experimental worker identity")
        epoch = await self.finance.acquire_writer_epoch(scope, worker_id)
        params = _run_params(scope, run_id)
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            if run["manifest_hash"] != manifest_hash:
                raise FinanceError("replay cursor manifest differs")
            old = (await conn.execute(text("""
                SELECT * FROM simulation_replay_cursor_claims
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND command_id=:command_id
            """), {**params, "command_id": command_id})).mappings().first()
            if old:
                expected = _receipt(old["previous_cursor_at"], old["next_cursor_at"],
                    old["manifest_hash"], old["source_root"],
                    old["account_snapshot_hash"], old["projection_revision"])
                if old["manifest_hash"] != manifest_hash or old["result_hash"] != expected:
                    raise FinanceError("replay cursor command identity conflicts")
                return {"previousCursorAt": old["previous_cursor_at"],
                        "nextCursorAt": old["next_cursor_at"],
                        "advanced": old["previous_cursor_at"] != old["next_cursor_at"],
                        "projectionRevision": old["projection_revision"],
                        "duplicate": True}
            await self.finance._writer(conn, account, epoch)
            manifest = SimulationRunManifest.model_validate_json(
                json.dumps(run["manifest_json"]))
            if manifest.manifest_hash != manifest_hash:
                raise FinanceError("replay cursor stored manifest hash differs")
            oracle, events = await verify_replay_checkpoint(conn, scope, manifest,
                                                             run, account)
            if oracle.economic_count:
                checkpoint = (await conn.execute(text("""
                    SELECT replay_cursor_at,source_root,manifest_hash
                    FROM simulation_derived_snapshots
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                      AND snapshot_hash=:snapshot
                """), {**params, "snapshot": account["observation_snapshot_hash"]})).mappings().first()
                if checkpoint is None or checkpoint["replay_cursor_at"] != \
                        run["replay_cursor_at"] or \
                        checkpoint["source_root"] != oracle.source_root or \
                        checkpoint["manifest_hash"] != manifest_hash:
                    raise FinanceError("economic source lacks current replay checkpoint")
                if account["reconciliation_state"] == "quarantined" and \
                        account["reconciliation_reason"] != \
                        "reserved_capacity_exceeds_observed":
                    raise FinanceError("unresolved replay quarantine blocks cursor")
                if account["reconciliation_state"] not in {"clean", "quarantined"}:
                    raise FinanceError("unknown financial state blocks replay cursor")
            elif account["reconciliation_state"] != "clean" or \
                    account["observation_snapshot_hash"] != manifest.account_snapshot_hash:
                raise FinanceError("initial replay cursor lacks clean opening checkpoint")
            current = run["replay_cursor_at"]
            following = await next_due_event_cursor(conn, manifest, current)
            deadline = await next_protection_deadline(conn, manifest, current)
            if deadline is not None and (following is None or deadline < following):
                following = deadline
            if following is None:
                following = manifest.scenario.simulation_end_at if \
                    current < manifest.scenario.simulation_end_at and \
                    await terminal_replay_ready(conn, params, run, account) else current
            if following < current or following > manifest.scenario.simulation_end_at:
                raise FinanceError("next replay fact is outside frozen scenario")
            revision = run["projection_revision"] + (1 if following > current else 0)
            digest = _receipt(current, following, manifest_hash, oracle.source_root,
                              account["observation_snapshot_hash"], revision)
            await conn.execute(text("""
                INSERT INTO simulation_replay_cursor_claims(environment,scope_id,
                  strategy_account_id,run_id,command_id,manifest_hash,
                  previous_cursor_at,next_cursor_at,source_root,account_snapshot_hash,
                  projection_revision,result_hash)
                VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
                  :command_id,:manifest_hash,:previous,:following,:source_root,
                  :account_snapshot_hash,:revision,:result_hash)
            """), {**params, "command_id": command_id,
                   "manifest_hash": manifest_hash, "previous": current,
                   "following": following, "source_root": oracle.source_root,
                   "account_snapshot_hash": account["observation_snapshot_hash"],
                   "revision": revision, "result_hash": digest})
            if following > current:
                changed = await conn.execute(text("""
                    UPDATE simulation_runs SET replay_cursor_at=:following,
                      cursor_sequence=cursor_sequence+1,
                      projection_revision=:revision,updated_at=clock_timestamp()
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                      AND replay_cursor_at=:previous AND manifest_hash=:manifest_hash
                """), {**params, "following": following, "revision": revision,
                       "previous": current, "manifest_hash": manifest_hash})
                if changed.rowcount != 1:
                    raise FinanceError("replay cursor changed before fenced advance")
            return {"previousCursorAt": current, "nextCursorAt": following,
                    "advanced": following > current,
                    "projectionRevision": revision, "duplicate": False}
