"""Commit a replay-derived account checkpoint after independent source verification."""
from __future__ import annotations

import json

from sqlalchemy import text

from .account_observation_storage import account_snapshot_hash
from .finance_capacity import capacity_identity_conflict, held_excess
from .finance_contracts import FinanceError, FinanceScope, _hash
from .finance_observation_contracts import account_snapshot_from_row
from .finance_policy import SizingPolicy
from .lifecycle_checkpoint_builder import build_derived_account_snapshot
from .lifecycle_checkpoint_verify import verify_replay_checkpoint
from .lifecycle_phase_receipts import PhaseCommand, load_phase_receipt, store_phase_receipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params


async def _insert_derived(conn, snapshot, manifest, oracle) -> None:
    body = snapshot.model_dump(mode="json")
    await conn.execute(text("""
        INSERT INTO observation_account_snapshots
          (snapshot_hash,environment,scope_id,strategy_account_id,source_account_id,
           status,origin,observed_balances,observed_positions,balances_complete,
           positions_complete,event_at,available_at,received_at,cutoff_at,finality,
           finality_at,has_gap,has_reorg,rights_ref,source_event_hash,source_payload_hash,
           policy_version,registry_hash)
        VALUES(:hash,:environment,:scope_id,:strategy_account_id,:source,:status,:origin,
          CAST(:balances AS jsonb),CAST(:positions AS jsonb),true,true,:event_at,
          :available_at,:received_at,:cutoff_at,:finality,:finality_at,false,false,
          :rights,:event_hash,:payload_hash,:policy,:registry)
        ON CONFLICT DO NOTHING
    """), {"hash": snapshot.snapshot_hash, **snapshot.scope.model_dump(),
           "source": snapshot.source_account_id, "status": snapshot.status,
           "origin": snapshot.origin,
           "balances": json.dumps(body["observed_balances"], sort_keys=True,
                                  separators=(",", ":"), ensure_ascii=False),
           "positions": json.dumps(body["observed_positions"], sort_keys=True,
                                   separators=(",", ":"), ensure_ascii=False),
           "event_at": snapshot.event_at, "available_at": snapshot.available_at,
           "received_at": snapshot.received_at, "cutoff_at": snapshot.cutoff_at,
           "finality": snapshot.finality, "finality_at": snapshot.finality_at,
           "rights": snapshot.rights_ref, "event_hash": snapshot.source_event_hash,
           "payload_hash": snapshot.source_payload_hash,
           "policy": snapshot.policy_version, "registry": snapshot.registry_hash})
    stored = (await conn.execute(text("""
        SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
    """), {"hash": snapshot.snapshot_hash})).mappings().one()
    if account_snapshot_from_row(stored) != snapshot or \
            account_snapshot_hash(snapshot) != snapshot.snapshot_hash:
        raise FinanceError("derived account observation identity conflicts")
    params = _run_params(snapshot.scope, manifest.run_id)
    await conn.execute(text("""
        INSERT INTO simulation_derived_snapshots(environment,scope_id,strategy_account_id,
          run_id,snapshot_hash,manifest_hash,baseline_snapshot_hash,replay_cursor_at,
          source_root,journal_root,position_root)
        VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:snapshot,:manifest,
          :baseline,:cursor,:source_root,:journal_root,:position_root)
        ON CONFLICT DO NOTHING
    """), {**params, "snapshot": snapshot.snapshot_hash,
           "manifest": manifest.manifest_hash,
           "baseline": manifest.account_snapshot_hash,
           "cursor": snapshot.cutoff_at,
           "source_root": oracle.source_root,
           "journal_root": oracle.journal_root,
           "position_root": oracle.position_root})
    row = (await conn.execute(text("""
        SELECT manifest_hash,baseline_snapshot_hash,replay_cursor_at,
          source_root,journal_root,position_root FROM simulation_derived_snapshots
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND snapshot_hash=:snapshot
    """), {**params, "snapshot": snapshot.snapshot_hash})).mappings().one()
    if dict(row) != {"manifest_hash": manifest.manifest_hash,
                     "baseline_snapshot_hash": manifest.account_snapshot_hash,
                     "replay_cursor_at": snapshot.cutoff_at,
                     "source_root": oracle.source_root,
                     "journal_root": oracle.journal_root,
                     "position_root": oracle.position_root}:
        raise FinanceError("derived checkpoint provenance conflicts")


class LifecycleCheckpointStoreMixin:
    async def reconcile_replay_checkpoint(self, scope: FinanceScope, run_id: str,
                                          manifest_hash: str, *, worker_id: str,
                                          command_id: str,
                                          phase_command: PhaseCommand | None = None) -> dict:
        """The immutable source, not the mutable ledger, supplies expected balances."""
        _hash(manifest_hash)
        if scope.environment != "experiment" or not worker_id or not command_id:
            raise FinanceError("derived checkpoint requires an experimental writer")
        epoch = await self.finance.acquire_writer_epoch(scope, worker_id)
        params = _run_params(scope, run_id)
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            await self.finance._writer(conn, account, epoch)
            if run["manifest_hash"] != manifest_hash:
                raise FinanceError("derived checkpoint run manifest changed")
            manifest = SimulationRunManifest.model_validate_json(
                json.dumps(run["manifest_json"]))
            if phase_command is not None:
                phase_command.bind(scope, run_id, manifest_hash, "checkpoint")
                prior_phase = await load_phase_receipt(conn, phase_command)
                if prior_phase is not None:
                    return prior_phase
            pending = (await conn.execute(text("""
                SELECT 1 FROM finance_pending_events WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id LIMIT 1
            """), params)).first()
            if pending:
                raise FinanceError("unresolved financial source blocks replay checkpoint")
            oracle, events = await verify_replay_checkpoint(conn, scope, manifest,
                                                             run, account)
            if oracle.economic_count == 0:
                raise FinanceError("empty economic replay needs no derived checkpoint")
            baseline_row = (await conn.execute(text("""
                SELECT * FROM observation_account_snapshots WHERE snapshot_hash=:hash
            """), {"hash": manifest.account_snapshot_hash})).mappings().one()
            baseline = account_snapshot_from_row(baseline_row)
            snapshot = build_derived_account_snapshot(baseline, oracle, events,
                scope=scope, run_id=run_id, manifest_hash=manifest_hash,
                policy_version=manifest.policy_version,
                replay_cursor_at=run["replay_cursor_at"])
            policy_row = (await conn.execute(text("""
                SELECT policy_json,policy_hash FROM finance_policy_versions
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND policy_version=:version
            """), {**params, "version": manifest.policy_version})).mappings().first()
            policy = SizingPolicy.model_validate_json(json.dumps(policy_row["policy_json"])) \
                if policy_row and policy_row["policy_hash"] == manifest.policy_hash else None
            if policy is None or policy.policy_hash != manifest.policy_hash or \
                    account["policy_hash"] != manifest.policy_hash or \
                    account["policy_version"] != manifest.policy_version or \
                    await capacity_identity_conflict(conn, scope, snapshot):
                raise FinanceError("derived checkpoint policy or capacity identity differs")
            same_snapshot = snapshot.snapshot_hash == account["observation_snapshot_hash"]
            if same_snapshot:
                currently_excess = await held_excess(conn, scope)
                if (account["reconciliation_state"] == "clean" and not currently_excess) or \
                        (account["reconciliation_state"] == "quarantined" and
                         account["reconciliation_reason"] ==
                         "reserved_capacity_exceeds_observed" and currently_excess):
                    outcome = {"status": account["reconciliation_state"],
                               "reason": account["reconciliation_reason"],
                               "snapshotHash": snapshot.snapshot_hash,
                               "revision": account["revision"], "duplicate": True}
                    return await store_phase_receipt(conn, phase_command, outcome) \
                        if phase_command is not None else outcome
                if account["reconciliation_state"] not in {"clean", "quarantined"} or \
                        (account["reconciliation_state"] == "quarantined" and
                         account["reconciliation_reason"] !=
                         "reserved_capacity_exceeds_observed"):
                    raise FinanceError("same source cannot clear another financial quarantine")
            await _insert_derived(conn, snapshot, manifest, oracle)
            revision = account["revision"] + 1
            await self.finance._replace_capacity(conn, scope, snapshot, policy, revision)
            excess = await held_excess(conn, scope)
            state = "quarantined" if excess else "clean"
            reason = "reserved_capacity_exceeds_observed" if excess else \
                     "matched_simulated_source"
            await conn.execute(text("""
                INSERT INTO finance_reconciliation_checkpoints(environment,scope_id,
                  strategy_account_id,account_revision,observation_snapshot_hash,
                  journal_root_hash,result,reason,observed_at)
                VALUES(:environment,:scope_id,:strategy_account_id,:revision,:snapshot,
                  :journal_root,:result,:reason,:observed_at)
            """), {**params, "revision": revision, "snapshot": snapshot.snapshot_hash,
                   "journal_root": oracle.journal_root, "result": state,
                   "reason": reason, "observed_at": snapshot.event_at})
            updated = await self.finance._advance(conn, scope, epoch, account,
                reconciliation_state=state, reconciliation_reason=reason,
                observation_snapshot_hash=snapshot.snapshot_hash,
                observed_at=snapshot.event_at)
            await conn.execute(text("""
                UPDATE simulation_positions SET reconciliation_state=:state,
                  reason=:reason,updated_at=clock_timestamp()
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**params, "state": state, "reason": reason})
            await conn.execute(text("""
                UPDATE simulation_runs SET projection_revision=projection_revision+1,
                  updated_at=clock_timestamp()
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)
            await self.finance._outbox(conn, scope, updated)
            outcome = {"status": state, "reason": reason,
                       "snapshotHash": snapshot.snapshot_hash,
                       "revision": updated["revision"], "duplicate": False}
            return await store_phase_receipt(conn, phase_command, outcome) \
                if phase_command is not None else outcome
