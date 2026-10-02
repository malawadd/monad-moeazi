"""Replay-specific financial entry admission; never uses wall-clock Stage 2 sizing."""
from __future__ import annotations

from datetime import timedelta
import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _hash
from .lifecycle_contracts import TradeIntent
from .lifecycle_decision import ReplayDecisionContext
from .lifecycle_entry_progress import load_entry_progress, store_entry_progress
from .lifecycle_order_ordinals import allocate_order_ordinal
from .lifecycle_replay_admission_inputs import load_replay_financial_inputs
from .lifecycle_replay_admission_checks import require_replay_entry_checkpoint
from .lifecycle_replay_admission_store import store_replay_admission
from .lifecycle_replay_intent import build_replay_intent
from .lifecycle_replay_sizing import build_replay_sizing_receipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .lifecycle_state import EntryAuthorizationRequest, EntryAuthorityReceipt


async def _request(conn, params: dict, request_id: str) -> dict:
    row = (await conn.execute(text("""
        SELECT * FROM simulation_entry_requests
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND request_id=:request_id FOR UPDATE
    """), {**params, "request_id": request_id})).mappings().first()
    if row is None:
        raise FinanceError("replay admission request is missing")
    return dict(row)


async def _stored_intent(conn, params: dict, progress: dict) -> TradeIntent:
    row = (await conn.execute(text("""
        SELECT intent_hash,intent_json FROM simulation_intents
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND intent_id=:intent_id
    """), {**params, "intent_id": progress["intentId"]})).mappings().first()
    if row is None:
        raise FinanceError("replay admission progress has no committed intent")
    intent = TradeIntent.model_validate_json(json.dumps(row["intent_json"]))
    if intent.intent_hash != row["intent_hash"] or \
            intent.intent_hash != progress["intentHash"] or \
            intent.calculation_receipt_hash != progress["calculationReceiptHash"]:
        raise FinanceError("replay admission intent identity conflicts")
    return intent


def _preparation_supported(action: str) -> bool:
    """Only spot has a qualified SQL reservation, preparation, and start path."""
    return action in {"spot_buy", "spot_sell"}


class LifecycleReplayEntryMixin:
    async def prepare_replay_entry(self, scope: FinanceScope, run_id: str,
                                   manifest_hash: str, request_id: str,
                                   worker_id: str, command_id: str) -> dict:
        _hash(manifest_hash)
        if scope.environment != "experiment" or not request_id or not worker_id or \
                not command_id or self.entry_authorizer is None:
            raise FinanceError("replay entry requires the authorized experiment worker")
        params = _run_params(scope, run_id)
        async with self.finance.engine.connect() as conn:
            run = await self._run(conn, scope, run_id, lock=False)
            request = await _request(conn, params, request_id)
            prior = await load_entry_progress(conn, scope, run_id, manifest_hash,
                                              request_id, "admission")
            if run["manifest_hash"] != manifest_hash or \
                    request["manifest_hash"] != manifest_hash or \
                    request["created_by_subject"] != run["created_by_subject"]:
                raise FinanceError("replay entry owner or manifest differs")
            manifest = SimulationRunManifest.model_validate_json(
                json.dumps(run["manifest_json"]))
        if prior is None:
            authorization = EntryAuthorizationRequest(schema_version=1, scope=scope,
                run_id=run_id, manifest_hash=manifest_hash,
                created_by_subject=run["created_by_subject"],
                experiment_request_hash=run["experiment_request_hash"],
                controller_ref=manifest.controller_ref,
                controller_mode=manifest.controller_mode,
                registered_authority_fingerprint=run["authority_fingerprint"],
                authority_epoch=run["authority_epoch"])
            fresh = await self.entry_authorizer(authorization)
            fresh = EntryAuthorityReceipt.model_validate_json(fresh.model_dump_json())
            if fresh.scope != scope or fresh.run_id != run_id or \
                    fresh.controller_ref != manifest.controller_ref or \
                    fresh.controller_mode != manifest.controller_mode or \
                    fresh.created_by_subject != run["created_by_subject"] or \
                    fresh.experiment_request_hash != run["experiment_request_hash"] or \
                    fresh.authority_fingerprint != run["authority_fingerprint"]:
                raise FinanceError("fresh replay identity differs from the registered run")
            epoch = await self.finance.acquire_writer_epoch(scope, worker_id)
            async with self.finance.engine.begin() as conn:
                account = await self.finance._lock(conn, scope)
                run = await self._run(conn, scope, run_id, lock=True)
                now = await self.finance._writer(conn, account, epoch)
                request = await _request(conn, params, request_id)
                prior = await load_entry_progress(conn, scope, run_id, manifest_hash,
                                                  request_id, "admission")
                if prior is None:
                    age = (now - fresh.checked_at).total_seconds()
                    if age < 0 or age > 5 or \
                            run["authority_fingerprint"] != fresh.authority_fingerprint or \
                            run["authority_epoch"] != account["authority_epoch"] or \
                            run["entries_stopped"] or \
                            account["admission_state"] != "open":
                        raise FinanceError("fresh replay entry authority expired or stopped")
                    evaluation = await load_entry_progress(conn, scope, run_id,
                        manifest_hash, request_id, "evaluation")
                    if evaluation is None or evaluation["requestHash"] != request["request_hash"]:
                        raise FinanceError("replay entry lacks frozen evaluation")
                    frozen_decision = ReplayDecisionContext.model_validate_json(
                        json.dumps(evaluation["decision"]))
                    if frozen_decision.cursor_at != run["replay_cursor_at"] or \
                            frozen_decision.account_snapshot_hash != \
                            account["observation_snapshot_hash"]:
                        return {"requestId": request_id, "status": "rejected",
                                "reason": "account_checkpoint_changed"}
                    inputs = await load_replay_financial_inputs(conn, scope, run,
                                                                  account, request)
                    draft = inputs["draft"]
                    if not _preparation_supported(draft.action):
                        return {"requestId": request_id, "status": "awaiting_finance",
                                "reason": "replay_order_preparation_unavailable"}
                    await require_replay_entry_checkpoint(conn, scope,
                        inputs["manifest"], run,
                        inputs["instrument"].instrument_version_id, draft.action)
                    ordinal = await allocate_order_ordinal(conn, scope, run_id,
                        manifest_hash, "entry", request_id)
                    try:
                        receipt = build_replay_sizing_receipt(inputs["manifest"],
                            inputs["decision"], inputs["policy"], inputs["instrument"],
                            inputs["book"], inputs["evidence"], inputs["dataset"],
                            inputs["snapshot"], inputs["positions"],
                            inputs["pending_receipts"], request_id=request_id,
                            action=draft.action, side=draft.side,
                            desired_quantity_units=draft.desired_quantity_units,
                            order_ordinal=ordinal,
                            account_revision=account["revision"])
                    except FinanceError:
                        return {"requestId": request_id, "status": "rejected",
                                "reason": "replay_policy_or_valuation_denied"}
                    intent = build_replay_intent(inputs["manifest"], inputs["decision"],
                                                 draft, receipt, request_id)
                    try:
                        await self.finance._capacity_check(conn, scope, receipt.components)
                    except FinanceError:
                        return {"requestId": request_id, "status": "rejected",
                                "reason": "replay_capacity_denied"}
                    expires_at = now + timedelta(
                        seconds=inputs["policy"].max_reservation_seconds)
                    prior = await store_replay_admission(self, conn, scope,
                        inputs["manifest"], run, account, request, receipt, intent,
                        epoch, fresh.authority_fingerprint, expires_at)
        if prior["requestHash"] != request["request_hash"]:
            raise FinanceError("replay entry retry changed its immutable request")
        async with self.finance.engine.connect() as conn:
            intent = await _stored_intent(conn, params, prior)
            reservation = await self.finance._reservation(conn, scope,
                                                          prior["reservationId"])
            if reservation["intent_id"] != intent.intent_id or \
                    reservation["calculation_receipt_hash"] != \
                    prior["calculationReceiptHash"]:
                raise FinanceError("replay admission reservation changed on recovery")
        prepared = await self.prepare_order(intent, prior["reservationId"],
            prior["orderOrdinal"], worker_id=worker_id,
            command_id=f"{command_id}:prepare")
        body = {"requestHash": request["request_hash"],
                "intentId": intent.intent_id, "reservationId": prior["reservationId"],
                "orderId": prepared["orderId"],
                "normalizedPayloadHash": prepared["normalizedPayloadHash"]}
        async with self.finance.engine.begin() as conn:
            await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            if run["manifest_hash"] != manifest_hash:
                raise FinanceError("prepared replay run changed before progress commit")
            await store_entry_progress(conn, scope, run_id, manifest_hash,
                                       request_id, "preparation", body)
        return {"requestId": request_id, "status":
                "awaiting_approval" if manifest.controller_mode == "approval_required"
                else "prepared", "orderId": prepared["orderId"]}
