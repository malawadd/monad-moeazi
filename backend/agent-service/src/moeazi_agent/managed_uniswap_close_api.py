"""Authenticated stopped-position close; only finalized finance may project flat."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import Field
from sqlalchemy import text

from .config import get_settings
from .finance_contracts import FinanceError, FinanceScope, StrictFinanceModel, native_int
from .finance_native_activation_api import _registered_policy
from .finance_observation_contracts import ARBITRUM_WETH_UNIT_ID
from .finance_routes import _subject, _viewer_scope
from .finance_uniswap_quote import (
    UniswapQuoteEvidenceRepository, UniswapV3Quote, quote_evidence_hash,
)
from .managed_uniswap_buy_api import _readiness, _sidecar
from .managed_uniswap_close_flow import (
    active_exit_grant, close_context, observe_stopped_pair, reconcile_exit,
)
from .managed_uniswap_exit_reservation import reserve_stopped_weth_exit
from .managed_uniswap_exit_submission import (
    load_exit_binding, mark_exit_submission_started,
)
from .managed_uniswap_observed_flat import (
    publish_observed_flat, verify_observed_flat,
)


router = APIRouter(prefix="/v1/finance/managed-program", tags=["managed finance close"])


class ClosePositionRequest(StrictFinanceModel):
    assignment_id: str = Field(alias="assignmentId", min_length=1, max_length=256)
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=256)


def _blocked(code: str, *, status: int = 409):
    raise HTTPException(status_code=status, detail={
        "status": "blocked", "code": code, "message": code.replace("_", " "),
        "submittedOperationMayStillSettle": False,
        "positionClosure": "unconfirmed"})


def _pending(code: str, *, operation_id: str | None = None,
             sidecar_state: str | None = None):
    return JSONResponse(status_code=202, content={
        "status": "pending", "code": code,
        "message": code.replace("_", " "),
        "operationId": operation_id,
        "sidecarState": sidecar_state,
        "admissionStopped": True,
        "submittedOperationMayStillSettle": True,
        "positionClosure": "unconfirmed"})


async def _publish_flat(settings, scope: FinanceScope, binding: dict,
                        reconciled: dict):
    outcome, proof = reconciled["operation"], reconciled["proof"]
    worker = settings.convex_worker_url.rstrip("/")
    if not worker.endswith("/worker"):
        raise FinanceError("Convex finance closure endpoint is not configured")
    payload = {"strategyAccountId": scope.strategy_account_id,
        "assignmentId": binding["assignment_id"],
        "programVersionId": binding["program_version_id"],
        "ownerAddress": binding["owner_address"],
        "grantId": binding["grant_id"],
        "financeSnapshotHash": proof["snapshotHash"],
        "financeRevision": str(proof["revision"]),
        "confirmedBlockNumber": outcome["confirmedBlockNumber"],
        "confirmedBlockHash": outcome["confirmedBlockHash"],
        "wethUnits": "0", "pendingAttemptCount": 0,
        "exitAttemptId": binding["attempt_id"],
        "exitReservationId": binding["reservation_id"],
        "exitIntentId": binding["intent_id"],
        "actualWethInputUnits": outcome["actualInputUnits"],
        "actualUsdcOutputUnits": outcome["actualOutputUnits"],
        "exitTransactionHash": outcome["transactionHash"],
        "journalTransactionId": proof["transactionId"]}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(worker[:-7] + "/native-finance-trade/closed",
            json=payload, headers={"Authorization": "Bearer "
                + settings.worker_shared_secret.get_secret_value()})
    if not response.is_success:
        return None
    value = response.json()
    if (not isinstance(value, dict) or value.get("closureConfirmed") is not True
            or not value.get("receiptId")):
        return None
    return value


async def _result_for_binding(finance, settings, scope: FinanceScope,
                              binding: dict):
    reconciled = await reconcile_exit(finance, scope=scope, binding=binding,
                                      context={})
    if reconciled["status"] != "confirmed_flat":
        return _pending(reconciled["code"],
            operation_id=binding["attempt_id"],
            sidecar_state=reconciled.get("sidecarState"))
    projected = await _publish_flat(settings, scope, binding, reconciled)
    if projected is None:
        return _pending("CONVEX_FLAT_PROJECTION_PENDING",
            operation_id=binding["attempt_id"])
    proof, operation = reconciled["proof"], reconciled["operation"]
    vault = bool(binding.get("vault_address"))
    return {"status": "confirmed_flat", "code":
        "FINALIZED_VAULT_EXIT_RECONCILED" if vault else "FINALIZED_EXIT_RECONCILED",
        "message": "Finalized WETH exit and financial account reconciled.",
        "operationId": binding["attempt_id"], "admissionStopped": True,
        "submittedOperationMayStillSettle": False,
        "unsettledOperationCount": 0,
        "positionClosure": "confirmed_flat",
        "exitGrant": {"verified": not vault,
            "expiresAt": None if vault else binding["deadline"]},
        "position": {"wethUnits": "0",
            "blockNumber": operation["confirmedBlockNumber"],
            "blockHash": operation["confirmedBlockHash"]},
        "closure": {"confirmed": True, "zeroExposure": True,
            "allOperationsSettled": True,
            "finalizedBlock": operation["confirmedBlockNumber"],
            "finalizedBlockHash": operation["confirmedBlockHash"],
            "financeSnapshotHash": proof["snapshotHash"],
            "financeRevision": proof["revision"],
            "receiptId": projected["receiptId"]}}


async def _result_for_observed_flat(finance, settings, scope: FinanceScope,
                                    context: dict, snapshot):
    proof = await verify_observed_flat(finance, scope, context, snapshot)
    projected = await publish_observed_flat(settings, scope, context, proof)
    if projected is None:
        return _pending("CONVEX_OBSERVED_FLAT_PROJECTION_PENDING")
    return {"status": "confirmed_flat", "code": "FINALIZED_NO_TRADE_FLAT",
        "message": "Finalized zero-WETH account and finance ledger reconciled.",
        "operationId": None, "admissionStopped": True,
        "submittedOperationMayStillSettle": False,
        "unsettledOperationCount": 0, "positionClosure": "confirmed_flat",
        "exitGrant": {"verified": False, "expiresAt": None},
        "position": {"wethUnits": "0",
            "blockNumber": proof["finalizedBlockNumber"],
            "blockHash": proof["finalizedBlockHash"]},
        "closure": {"confirmed": True, "zeroExposure": True,
            "allOperationsSettled": True,
            "finalizedBlock": proof["finalizedBlockNumber"],
            "finalizedBlockHash": proof["finalizedBlockHash"],
            "financeSnapshotHash": proof["financeSnapshotHash"],
            "financeRevision": proof["financeRevision"],
            "receiptId": projected["receiptId"]}}


@router.post("/close-position")
async def close_managed_position(body: ClosePositionRequest, request: Request,
        authorization: str | None = Header(default=None),
        x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    settings = get_settings()
    finance = getattr(request.app.state, "finance", None)
    if finance is None:
        _blocked("FINANCIAL_WRITER_UNAVAILABLE", status=503)
    try:
        scope = await _viewer_scope(subject, "live", None)
        existing = await load_exit_binding(finance, scope, body.assignment_id,
                                           body.idempotency_key)
        if existing:
            if existing["customer_subject"] != subject:
                _blocked("EXIT_COMMAND_OWNER_CHANGED")
            return await _result_for_binding(finance, settings, scope, existing)
        context = await close_context(settings, body.assignment_id, subject)
        if context["strategyAccountId"] != scope.strategy_account_id:
            _blocked("CLOSE_OWNER_ACCOUNT_MISMATCH")
        if isinstance(context.get("vault"), dict):
            from .managed_vault_exit_flow import execute_vault_exit
            return await execute_vault_exit(finance, settings, scope=scope,
                context=context, subject=subject,
                command_id=body.idempotency_key)
        snapshot = await observe_stopped_pair(finance, scope, context,
            command_id=body.idempotency_key)
        location = snapshot.source_account_id
        rows = [item for item in snapshot.observed_balances
                if item.asset_unit_id == ARBITRUM_WETH_UNIT_ID
                and item.location_id == location and item.book == "wallet"]
        if len(rows) != 1:
            _blocked("FINALIZED_WETH_BALANCE_UNAVAILABLE")
        amount_in = native_int(rows[0].units, nonnegative=True)
        if amount_in == 0:
            return await _result_for_observed_flat(finance, settings, scope,
                                                   context, snapshot)
        grant = await active_exit_grant(context)
        await _readiness()
        review = grant["review"]
        if amount_in > native_int(review["maximumInputUnits"], positive=True):
            _blocked("EXIT_GRANT_BELOW_FINALIZED_WETH_BALANCE")
        raw_quote = await _sidecar("scoped-quote", {"scope": "exit",
            "amountIn": str(amount_in),
            "slippageBps": context["maxSlippageBps"]})
        quote = UniswapV3Quote.model_validate(raw_quote)
        if (quote.amount_in != str(amount_in)
                or native_int(quote.minimum_amount_out, positive=True)
                    < native_int(review["minimumOutputUnits"], positive=True)):
            _blocked("EXIT_QUOTE_OUTSIDE_OWNER_GRANT")
        await UniswapQuoteEvidenceRepository(finance.engine).store_sidecar_quote(
            raw_quote, received_at=datetime.now(timezone.utc))
        async with finance.engine.connect() as conn:
            account = (await conn.execute(text("""
              SELECT revision,policy_version,policy_hash FROM finance_accounts
              WHERE environment='live' AND scope_id='live'
                AND strategy_account_id=:account
            """), {"account": scope.strategy_account_id})).mappings().first()
        if account is None:
            _blocked("NATIVE_ACCOUNT_UNAVAILABLE")
        policy = await _registered_policy(finance, scope,
            account["policy_version"], account["policy_hash"])
        expires = min(datetime.fromtimestamp(int(grant["expiresAt"]), timezone.utc),
            datetime.now(timezone.utc)
                + timedelta(seconds=policy.max_reservation_seconds))
        epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
        hold = await reserve_stopped_weth_exit(finance, scope=scope,
            context=context, quote=quote, command_id=body.idempotency_key,
            writer_epoch=epoch, expires_at=expires)
        submit = {"grantId": context["executionGrantId"], "scope": "exit",
            "strategyAccountId": scope.strategy_account_id,
            "assignmentId": context["assignmentId"], "intentId": hold["intentId"],
            "idempotencyKey": body.idempotency_key, "amountIn": quote.amount_in,
            "amountOutMinimum": quote.minimum_amount_out,
            "deadline": int(expires.timestamp())}
        prepared = await _sidecar("scoped-prepare-broadcast", submit)
        if (not isinstance(prepared, dict)
                or prepared.get("intentId") != hold["intentId"]
                or prepared.get("clientId") != body.idempotency_key
                or prepared.get("amountIn") != quote.amount_in
                or prepared.get("amountOutMinimum") != quote.minimum_amount_out
                or prepared.get("owner") != context["ownerAddress"]
                or not isinstance(prepared.get("normalizedPayloadHash"), str)):
            _blocked("EXIT_PREPARED_CALL_DIFFERS_FROM_HELD_QUOTE")
        marker = await mark_exit_submission_started(finance, scope=scope,
            reservation_id=hold["reservationId"], context=context,
            command_id=body.idempotency_key, quote_hash=quote_evidence_hash(quote),
            amount_in=quote.amount_in,
            amount_out_minimum=quote.minimum_amount_out,
            deadline=int(expires.timestamp()),
            normalized_payload_hash=prepared["normalizedPayloadHash"],
            writer_epoch=epoch, expected_revision=int(hold["revision"]))
        try:
            await _sidecar("broadcast", submit, timeout=45)
        except Exception:
            current = await finance.read_account_risk_snapshot(scope)
            await finance.mark_submission_uncertain(scope, hold["reservationId"],
                epoch, int(current["accountRevision"]),
                "native-uniswap-exit-uncertain:" + hold["intentId"])
        binding = await load_exit_binding(finance, scope, body.assignment_id,
                                          body.idempotency_key)
        if not binding or binding["attempt_id"] != marker["attemptId"]:
            _blocked("DURABLE_EXIT_ATTEMPT_UNAVAILABLE", status=503)
        return await _result_for_binding(finance, settings, scope, binding)
    except HTTPException:
        raise
    except FinanceError as exc:
        _blocked(str(exc))
    except Exception:
        _blocked("MANAGED_EXIT_DEPENDENCY_UNAVAILABLE", status=503)
