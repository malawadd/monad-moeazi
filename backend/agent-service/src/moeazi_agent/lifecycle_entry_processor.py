"""Durable worker entry evaluation followed by separately gated financial admission."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest, _hash
from .lifecycle_decision import ReplayDecisionContext
from .lifecycle_entry_evaluation import evaluate_entry_request
from .lifecycle_entry_progress import load_entry_progress, store_entry_progress
from .lifecycle_entry_selection import claim_entry_request
from .lifecycle_run_store import _run_params


async def _mark(repository, scope, run_id, manifest_hash, request_id,
                worker_id, status, reason=None, order_id=None):
    epoch = await repository.finance.acquire_writer_epoch(scope, worker_id)
    params = {**_run_params(scope, run_id), "request_id": request_id}
    async with repository.finance.engine.begin() as conn:
        account = await repository.finance._lock(conn, scope)
        run = await repository._run(conn, scope, run_id, lock=True)
        await repository.finance._writer(conn, account, epoch)
        if run["manifest_hash"] != manifest_hash:
            raise FinanceError("Entry progress manifest changed")
        row = (await conn.execute(text("""
            SELECT status,reason,order_id FROM simulation_entry_requests
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
              AND request_id=:request_id FOR UPDATE
        """), params)).mappings().one()
        if row["status"] in {"rejected", "completed", "submission_possible"}:
            return {"requestId": request_id, "status": row["status"],
                "orderId": row["order_id"], "reason": row["reason"],
                "projectionRevision": run["projection_revision"]}
        if row["order_id"] and order_id and row["order_id"] != order_id:
            raise FinanceError("Entry processing changed its economic order")
        order_id = order_id or row["order_id"]
        revision = run["projection_revision"]
        if (row["status"], row["reason"], row["order_id"]) != (status, reason, order_id):
            await conn.execute(text("""
                UPDATE simulation_entry_requests SET status=:status,reason=:reason,
                  order_id=:order_id,updated_at=clock_timestamp()
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND request_id=:request_id
            """), {**params, "status": status, "reason": reason, "order_id": order_id})
            revision += 1
            await conn.execute(text("""
                UPDATE simulation_runs SET projection_revision=:revision,updated_at=clock_timestamp()
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**params, "revision": revision})
        return {"requestId": request_id, "status": status, "orderId": order_id,
                "reason": reason, "projectionRevision": revision}


class LifecycleEntryProcessorMixin:
    async def process_next_entry_request(self, scope: FinanceScope, run_id: str,
                                         manifest_hash: str, worker_id: str,
                                         command_id: str) -> dict:
        _hash(manifest_hash)
        if scope.environment != "experiment" or not worker_id or not command_id or \
                len(command_id) > 160 or self.entry_authorizer is None:
            raise FinanceError("Entry processing requires the isolated authorized worker")
        epoch = await self.finance.acquire_writer_epoch(scope, worker_id)
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            await self.finance._writer(conn, account, epoch)
            if run["manifest_hash"] != manifest_hash:
                raise FinanceError("Entry processing manifest differs")
            if run["entries_stopped"] or account["admission_state"] != "open" or \
                    run["authority_epoch"] != account["authority_epoch"]:
                return {"requestId": None, "status": "entries_stopped",
                        "projectionRevision": run["projection_revision"]}
            request = await claim_entry_request(conn, scope, run_id, manifest_hash, command_id)
            if request is None:
                return {"requestId": None, "status": "idle",
                        "projectionRevision": run["projection_revision"]}
            request_id = request["request_id"]
            if request["status"] in {"completed", "rejected", "submission_possible"}:
                return {"requestId": request_id, "status": request["status"],
                        "orderId": request["order_id"], "reason": request["reason"],
                        "projectionRevision": run["projection_revision"]}
            evaluation = await load_entry_progress(conn, scope, run_id,
                manifest_hash, request_id, "evaluation")
        if evaluation is None:
            try:
                evaluation = await evaluate_entry_request(self, scope, run, request)
            except FinanceError:
                return await _mark(self, scope, run_id, manifest_hash, request_id,
                    worker_id, "awaiting_evidence", "current_replay_evaluation_unavailable")
            async with self.finance.engine.begin() as conn:
                current = await self.finance._lock(conn, scope)
                current_run = await self._run(conn, scope, run_id, lock=True)
                await self.finance._writer(conn, current, epoch)
                decision = ReplayDecisionContext.model_validate_json(json.dumps(evaluation["decision"]))
                if current_run["entries_stopped"] or current["admission_state"] != "open" or \
                        current_run["authority_epoch"] != current["authority_epoch"] or \
                        current_run["replay_cursor_at"] != decision.cursor_at or \
                        current["observation_snapshot_hash"] != decision.account_snapshot_hash or \
                        current["reconciliation_state"] != "clean":
                    raise FinanceError("Entry checkpoint changed before evaluation commit")
                await store_entry_progress(conn, scope, run_id, manifest_hash,
                    request_id, "evaluation", evaluation)
        if evaluation["requestHash"] != request["request_hash"]:
            raise FinanceError("Recovered evaluation belongs to another request")
        if evaluation["draft"]["action"] == "hold":
            return await _mark(self, scope, run_id, manifest_hash, request_id,
                worker_id, "completed", "strategy_trigger_not_met")
        # Replay admission owns its explicit supported-instrument gates; historic
        # facts never enter the older wall-clock-only Stage 2 sizing path.
        admission_command = _digest("moeazi-entry-admission-command-v1", {
            "scope": scope.model_dump(mode="json"), "runId": run_id, "requestId": request_id})
        outcome = await self.prepare_replay_entry(scope, run_id, manifest_hash, request_id,
            worker_id, f"entry:{admission_command}")
        if not isinstance(outcome, dict) or outcome.get("requestId") != request_id:
            raise FinanceError("Financial entry preparation returned another request")
        status = outcome.get("status")
        if status not in {"awaiting_finance", "awaiting_approval", "prepared", "rejected"}:
            raise FinanceError("Financial entry preparation returned an unknown state")
        reason = outcome.get("reason")
        if reason is not None and (not isinstance(reason, str) or not reason or len(reason) > 160):
            raise FinanceError("Financial entry preparation returned an invalid reason")
        if status == "rejected":
            if reason is None:
                raise FinanceError("Rejected entry requires a durable financial reason")
            # The financial owner must resolve any earlier reservation before
            # returning this terminal disposition. Frozen evaluations are never
            # replaced: another evaluation requires a new explicit request.
            return await _mark(self, scope, run_id, manifest_hash, request_id,
                worker_id, "rejected", reason)
        if status == "awaiting_finance":
            return await _mark(self, scope, run_id, manifest_hash, request_id,
                worker_id, status, reason or "financial_admission_pending")
        order_id = outcome.get("orderId")
        if not isinstance(order_id, str) or not order_id or outcome.get("requestId") != request_id:
            raise FinanceError("Financial entry preparation omitted its exact order identity")
        approval = None
        if status == "awaiting_approval":
            params = {**_run_params(scope, run_id), "order_id": order_id}
            async with self.finance.engine.connect() as conn:
                approval = (await conn.execute(text("""
                    SELECT a.approval_hash FROM simulation_approval_receipts a
                    JOIN simulation_order_preparations p
                      ON p.environment=a.environment AND p.scope_id=a.scope_id
                      AND p.strategy_account_id=a.strategy_account_id AND p.run_id=a.run_id
                      AND p.intent_hash=a.intent_hash
                      AND p.normalized_payload_hash=a.normalized_payload_hash
                    WHERE p.environment=:environment AND p.scope_id=:scope_id
                      AND p.strategy_account_id=:strategy_account_id AND p.run_id=:run_id
                      AND p.order_id=:order_id AND a.expires_at>clock_timestamp()
                      AND NOT EXISTS (SELECT 1 FROM simulation_approval_revocations x
                        WHERE x.environment=a.environment AND x.scope_id=a.scope_id
                          AND x.strategy_account_id=a.strategy_account_id
                          AND x.run_id=a.run_id AND x.approval_hash=a.approval_hash)
                    ORDER BY a.approved_at DESC,a.approval_hash DESC LIMIT 1
                """), params)).scalar_one_or_none()
            if approval is None:
                return await _mark(self, scope, run_id, manifest_hash, request_id,
                    worker_id, "awaiting_approval", "exact_payload_approval_required", order_id)
        await self.start_order(scope, run_id, order_id, worker_id=worker_id,
                               approval_receipt_hash=approval)
        return await _mark(self, scope, run_id, manifest_hash, request_id,
                           worker_id, "submission_possible", order_id=order_id)
