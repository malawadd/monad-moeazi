"""Fenced run checkpoint; later economic steps extend this persisted cursor."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _hash
from .lifecycle_run_store import _run_params, _run_result
from .lifecycle_advance_phases import advance_one_phase
from .lifecycle_replay_cursor import terminal_replay_ready
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_state import RunAdvanceResult


class LifecycleAdvanceMixin:
    async def advance_run(self, scope: FinanceScope, run_id: str, manifest_hash: str,
                          worker_id: str, command_id: str, *,
                          entries_inhibited: bool = False) -> RunAdvanceResult:
        _hash(manifest_hash)
        if not worker_id or not command_id or type(entries_inhibited) is not bool:
            raise FinanceError("simulation advance lacks a stable worker command")
        params = _run_params(scope, run_id)
        async with self.finance.engine.connect() as conn:
            prior = (await conn.execute(text("""
                SELECT manifest_hash,result_json FROM simulation_advance_claims
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND command_id=:command_id
            """), {**params, "command_id": command_id})).mappings().first()
        if prior:
            result = prior["result_json"]
            if prior["manifest_hash"] != manifest_hash or \
                    result["entriesInhibited"] != entries_inhibited:
                raise FinanceError("simulation advance command id conflicts")
            return RunAdvanceResult.model_validate_json(json.dumps(result["result"]))
        phase_progress = await advance_one_phase(self, scope, run_id, manifest_hash,
            worker_id, command_id, entries_inhibited=entries_inhibited)
        # The DB lease is for operational writes; simulation timestamps never
        # replace the DB wall clock used by this writer fence.
        writer_epoch = await self.finance.acquire_writer_epoch(scope, worker_id)
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            if run["manifest_hash"] != manifest_hash:
                raise FinanceError("simulation advance manifest differs")
            prior = (await conn.execute(text("""
                SELECT manifest_hash,result_json FROM simulation_advance_claims
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND command_id=:command_id
            """), {**params, "command_id": command_id})).mappings().first()
            if prior:
                result = prior["result_json"]
                if prior["manifest_hash"] != manifest_hash or \
                        result["entriesInhibited"] != entries_inhibited:
                    raise FinanceError("simulation advance command id conflicts")
                return RunAdvanceResult.model_validate_json(json.dumps(result["result"]))
            await self.finance._writer(conn, account, writer_epoch)
            if run["entries_stopped"]:
                await conn.execute(text("""
                    UPDATE simulation_entry_requests SET status='rejected',
                      reason='entries_stopped',updated_at=clock_timestamp()
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                      AND status='queued'
                """), params)
            pending_requests = (await conn.execute(text("""
                SELECT EXISTS(SELECT 1 FROM simulation_entry_requests
                  WHERE environment=:environment AND scope_id=:scope_id
                    AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                    AND status NOT IN ('rejected','completed','submission_possible'))
            """), params)).scalar_one()
            pending_orders = (await conn.execute(text("""
                SELECT EXISTS(SELECT 1 FROM simulation_orders o
                  JOIN finance_reservations r ON r.environment=o.environment
                    AND r.scope_id=o.scope_id AND r.strategy_account_id=o.strategy_account_id
                    AND r.reservation_id=o.reservation_id
                  WHERE o.environment=:environment AND o.scope_id=:scope_id
                    AND o.strategy_account_id=:strategy_account_id AND o.run_id=:run_id
                    AND (o.status NOT IN ('filled','cancelled','rejected') OR
                         r.status NOT IN ('settled','released')))
            """), params)).scalar_one()
            exposed = (await conn.execute(text("""
                SELECT EXISTS(SELECT 1 FROM simulation_positions
                  WHERE environment=:environment AND scope_id=:scope_id
                    AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                    AND (signed_exposure_units<>0 OR pending_obligations OR
                         reconciliation_state<>'clean'))
            """), params)).scalar_one()
            pending_protection = (await conn.execute(text("""
                SELECT EXISTS(SELECT 1 FROM simulation_protections
                  WHERE environment=:environment AND scope_id=:scope_id
                    AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                    AND resolution_hash IS NULL
                    AND status IN ('intended','requested','confirmed','rejected','uncertain'))
            """), params)).scalar_one()
            pending_controls = (await conn.execute(text("""
                SELECT EXISTS(SELECT 1 FROM simulation_commands c
                  WHERE c.environment=:environment AND c.scope_id=:scope_id
                    AND c.strategy_account_id=:strategy_account_id AND c.run_id=:run_id
                    AND c.outcome='applied'
                    AND c.operation IN ('request_cancel','request_close')
                    AND NOT EXISTS(SELECT 1 FROM simulation_control_processing p
                      WHERE p.environment=c.environment AND p.scope_id=c.scope_id
                        AND p.strategy_account_id=c.strategy_account_id AND p.run_id=c.run_id
                        AND p.command_id=c.command_id AND p.processing_kind='resolved'))
            """), params)).scalar_one()
            pending = bool(pending_orders or exposed or pending_protection or
                           pending_requests or pending_controls)
            if run["status"] == "completed_flat" and pending:
                raise FinanceError("completed run has newly discovered obligations")
            manifest = SimulationRunManifest.model_validate_json(
                json.dumps(run["manifest_json"]))
            terminal_ready = await terminal_replay_ready(conn, params, run, account)
            at_scenario_end = run["replay_cursor_at"] == manifest.scenario.simulation_end_at
            end_checkpoint_ready = False
            if terminal_ready and at_scenario_end:
                has_economic_source = (await conn.execute(text("""
                    SELECT EXISTS(SELECT 1 FROM simulation_event_folds
                      WHERE environment=:environment AND scope_id=:scope_id
                        AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                        AND event_kind IN ('fill','funding'))
                """), params)).scalar_one()
                if not has_economic_source:
                    end_checkpoint_ready = True
                else:
                    end_checkpoint_ready = (await conn.execute(text("""
                        SELECT EXISTS(SELECT 1 FROM simulation_derived_snapshots
                          WHERE environment=:environment AND scope_id=:scope_id
                            AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                            AND manifest_hash=:manifest_hash
                            AND replay_cursor_at=:cursor
                            AND snapshot_hash=:snapshot_hash)
                    """), {**params, "manifest_hash": manifest_hash,
                           "cursor": manifest.scenario.simulation_end_at,
                           "snapshot_hash": account["observation_snapshot_hash"]})).scalar_one()
            if account["reconciliation_state"] != "clean":
                status = "quarantined"
            elif pending_protection or exposed:
                status = "stopped_with_exposure" if run["entries_stopped"] else "awaiting_protection"
            elif pending_orders:
                status = "awaiting_evidence"
            elif pending_requests:
                status = "running"
            elif run["entries_stopped"]:
                status = "completed_flat" if terminal_ready and end_checkpoint_ready else "running"
            else:
                status = run["status"] if run["status"] == "running" else "registered"
            if run["status"] != status or run["pending_obligations"] != pending:
                run["status"], run["pending_obligations"] = status, pending
                run["projection_revision"] += 1
                await conn.execute(text("""
                    UPDATE simulation_runs SET status=:status,pending_obligations=:pending,
                      projection_revision=:revision,updated_at=clock_timestamp()
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                """), {**params, "status": status, "pending": pending,
                       "revision": run["projection_revision"]})
            result = _run_result(run)
            if phase_progress and result.status != "completed_flat":
                result = RunAdvanceResult.model_validate({**result.model_dump(),
                    "next_action": "advance"})
            payload = {"entriesInhibited": entries_inhibited,
                       "result": result.model_dump(mode="json")}
            await conn.execute(text("""
                INSERT INTO simulation_advance_claims(environment,scope_id,
                  strategy_account_id,run_id,command_id,manifest_hash,result_json)
                VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
                  :command_id,:manifest_hash,CAST(:result_json AS jsonb))
            """), {**params, "command_id": command_id, "manifest_hash": manifest_hash,
                   "result_json": json.dumps(payload, sort_keys=True,
                                             separators=(",", ":"), ensure_ascii=False)})
            return result
