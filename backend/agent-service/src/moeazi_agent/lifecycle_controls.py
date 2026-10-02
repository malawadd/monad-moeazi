"""Durable controls narrow entry authority without depending on the writer lease."""
from __future__ import annotations

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest, _hash
from .finance_repository import _scope
from .lifecycle_run_store import _run_params
from .simulation_workflow_contracts import SimulationControl


class LifecycleControlsMixin:
    async def apply_control(self, scope: FinanceScope, run_id: str,
                            manifest_hash: str, control: SimulationControl, *,
                            worker_id: str, command_id: str,
                            requested_by_subject: str | None = None) -> dict:
        """The authenticated API persists this before signaling Temporal."""
        _hash(manifest_hash)
        if not worker_id or command_id != control.command_id or \
                (requested_by_subject is not None and not
                 1 <= len(requested_by_subject) <= 512):
            raise FinanceError("simulation control has an unstable command identity")
        digest = _digest("moeazi-simulation-control-v1", {
            "scope": scope.model_dump(mode="json"), "runId": run_id,
            "manifestHash": manifest_hash, "control": control.model_dump(mode="json"),
        })
        params = _run_params(scope, run_id)
        async with self.finance.engine.begin() as conn:
            await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            if run["manifest_hash"] != manifest_hash:
                raise FinanceError("simulation control manifest differs")
            if requested_by_subject is not None and \
                    requested_by_subject != run["created_by_subject"]:
                raise FinanceError("simulation control actor differs from run owner")
            prior = (await conn.execute(text("""
                SELECT command_hash,operation,outcome,projection_revision,
                  requested_by_subject
                FROM simulation_commands WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND command_id=:command_id
            """), {**params, "command_id": command_id})).mappings().first()
            if prior:
                if prior["command_hash"] != digest or \
                        prior["requested_by_subject"] != requested_by_subject:
                    raise FinanceError("simulation control command id conflicts")
                return {"commandId": command_id, "operation": prior["operation"],
                        "outcome": prior["outcome"],
                        "projectionRevision": prior["projection_revision"]}
            outcome, reason = "applied", None
            if control.operation == "stop_entries":
                await conn.execute(text("""
                    UPDATE simulation_runs SET entries_stopped=true,
                      updated_at=clock_timestamp() WHERE environment=:environment
                      AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                      AND run_id=:run_id
                """), params)
            elif control.operation == "request_cancel":
                row = (await conn.execute(text("""
                    SELECT status FROM simulation_orders WHERE environment=:environment
                      AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                      AND run_id=:run_id AND order_id=:order_id FOR UPDATE
                """), {**params, "order_id": control.order_id})).mappings().first()
                if row is None or row["status"] in {"filled", "cancelled", "rejected"}:
                    outcome, reason = "rejected", "order_not_cancellable"
                else:
                    await conn.execute(text("""
                        UPDATE simulation_orders SET status='cancel_requested',
                          updated_at=clock_timestamp() WHERE environment=:environment
                          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                          AND run_id=:run_id AND order_id=:order_id
                    """), {**params, "order_id": control.order_id})
            else:
                row = (await conn.execute(text("""
                    SELECT signed_exposure_units FROM simulation_positions
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                      AND instrument_version_id=:instrument FOR UPDATE
                """), {**params, "instrument": control.instrument_version_id})).mappings().all()
                if not row or all(value["signed_exposure_units"] == 0 for value in row):
                    outcome, reason = "rejected", "no_scoped_position_to_close"
                else:
                    await conn.execute(text("""
                        UPDATE simulation_runs SET status='awaiting_protection',
                          pending_obligations=true,updated_at=clock_timestamp()
                        WHERE environment=:environment AND scope_id=:scope_id
                          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                    """), params)
            revision = run["projection_revision"] + 1
            await conn.execute(text("""
                UPDATE simulation_runs SET projection_revision=:revision,
                  updated_at=clock_timestamp() WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id
            """), {**params, "revision": revision})
            await conn.execute(text("""
                INSERT INTO simulation_commands(environment,scope_id,strategy_account_id,
                  run_id,command_id,command_hash,operation,target_id,outcome,reason,
                  projection_revision,requested_by_subject)
                VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:command_id,
                  :digest,:operation,:target,:outcome,:reason,:revision,:subject)
            """), {**params, "command_id": command_id, "digest": digest,
                   "operation": control.operation,
                   "target": control.order_id or control.instrument_version_id,
                   "outcome": outcome, "reason": reason, "revision": revision,
                   "subject": requested_by_subject})
            return {"commandId": command_id, "operation": control.operation,
                    "outcome": outcome, "projectionRevision": revision}
