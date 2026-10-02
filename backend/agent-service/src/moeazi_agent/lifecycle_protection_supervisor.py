"""Deadline containment independent of research, provider budget or browser state."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope
from .lifecycle_phase_receipts import PhaseCommand, load_phase_receipt, store_phase_receipt
from .lifecycle_protection_contracts import ProtectionObligation
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params

DEADLINE_REASON = "protection_deadline_elapsed_stop_and_escalate"


class LifecycleProtectionSupervisorMixin:
    async def process_protection_deadlines(self, scope: FinanceScope, run_id: str,
                                          manifest_hash: str, *, worker_id: str,
                                          phase_command: PhaseCommand) -> dict:
        """Contain new risk; never release holds, invent a quote or claim flatness."""
        phase_command.bind(scope, run_id, manifest_hash, "protection")
        if scope.environment != "experiment" or not worker_id:
            raise FinanceError("Protection supervisor requires an experimental writer")
        epoch = await self.finance.acquire_writer_epoch(scope, worker_id)
        params = _run_params(scope, run_id)
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            await self.finance._writer(conn, account, epoch)
            if run["manifest_hash"] != manifest_hash:
                raise FinanceError("Protection supervisor manifest differs")
            manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
            prior = await load_phase_receipt(conn, phase_command)
            if prior is not None:
                return prior
            rows = (await conn.execute(text("""
                SELECT protection_order_id,originating_event_hash,intended_hash,intended_json
                FROM simulation_protections WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND status IN ('intended','requested','confirmed','rejected','uncertain')
                  AND intended_json IS NOT NULL
                  AND resolution_hash IS NULL
                  AND (intended_json->>'deadline_at_cursor')::timestamptz<=:cursor
                  AND reason IS DISTINCT FROM :reason
                ORDER BY (intended_json->>'deadline_at_cursor')::timestamptz,protection_order_id
                LIMIT 128 FOR UPDATE
            """), {**params, "cursor": run["replay_cursor_at"], "reason": DEADLINE_REASON})).mappings().all()
            for row in rows:
                obligation = ProtectionObligation.model_validate_json(json.dumps(row["intended_json"]))
                if obligation.scope != scope or obligation.run_id != run_id or \
                        obligation.manifest_hash != manifest_hash or \
                        obligation.policy_hash != manifest.policy_hash or \
                        obligation.intended_hash != row["intended_hash"] or \
                        obligation.originating_event_hash != row["originating_event_hash"] or \
                        obligation.protection_order_id != row["protection_order_id"] or \
                        obligation.deadline_at_cursor > run["replay_cursor_at"]:
                    raise FinanceError("Due protection obligation identity differs")
                await conn.execute(text("""
                    UPDATE simulation_protections SET reason=:reason,updated_at=clock_timestamp()
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                      AND protection_order_id=:protection
                """), {**params, "protection": obligation.protection_order_id, "reason": DEADLINE_REASON})
            if rows:
                await conn.execute(text("""
                    UPDATE simulation_runs SET entries_stopped=true,pending_obligations=true,
                      status='stopped_with_exposure',projection_revision=projection_revision+1,
                      updated_at=clock_timestamp() WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                """), params)
            return await store_phase_receipt(conn, phase_command, {
                "stoppedEntries": bool(run["entries_stopped"] or rows),
                "escalatedCount": len(rows),
                "projectionRevision": run["projection_revision"] + bool(rows),
                "exposureClosed": False, "holdsReleased": False})
