"""One authenticated, finance-owned managed USDC-to-WETH execution lane."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from hmac import compare_digest
from math import isfinite

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import Field
from sqlalchemy import text

from .config import get_settings
from .contracts import TradeProposal
from .controller_contracts import ControllerRef
from .convex import ConvexWorkerClient
from .execution_controller import require_executable_controller
from .policy import AutomationPolicy
from .finance_contracts import (
    FinanceError, FinanceScope, ReserveCommand, StrictFinanceModel, native_int,
    semantic_request_hash,
)
from .finance_native_activation_api import _activation_url
from .finance_policy import SizingReceipt
from .finance_uniswap_quote import (
    UniswapQuoteEvidenceRepository, UniswapV3Quote, load_uniswap_quote, quote_evidence_hash,
)
from .managed_uniswap_buy_submission import (
    load_attempt_binding, mark_managed_submission_started,
)
from .managed_uniswap_buy_state import (
    current_account, existing_trade, initial_buy_request, intent_id,
    managed_identity, proposal_amount_in,
)
from .managed_uniswap_buy_settlement import settle_confirmed_buy


router = APIRouter(prefix="/v1/finance/managed-program", tags=["managed finance execution"])


class ExecuteBuyRequest(StrictFinanceModel):
    proposal_id: str = Field(alias="proposalId", min_length=1, max_length=256)
    command_id: str = Field(alias="commandId", min_length=1, max_length=256)


def _block(reason: str, status: int = 409):
    raise HTTPException(status_code=status, detail={"status": "blocked", "reason": reason})


async def _sidecar(path: str, payload: dict, *, timeout: float = 30) -> dict | None:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(settings.execution_sidecar_url.rstrip("/")
            + "/internal/uniswap/" + path, json=payload,
            headers={"Authorization": "Bearer " + settings.worker_shared_secret.get_secret_value()})
    if not response.is_success:
        raise RuntimeError("scoped Uniswap sidecar rejected an exact operation")
    data = response.json()
    if path == "scoped-reconcile" and data is None:
        return None
    if not isinstance(data, dict):
        raise ValueError("scoped Uniswap response must be an object")
    return data


async def _readiness() -> None:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=settings.routing_timeout_seconds) as client:
        response = await client.get(settings.execution_sidecar_url.rstrip("/")
            + "/internal/uniswap/scoped-readiness", headers={
            "Authorization": "Bearer " + settings.worker_shared_secret.get_secret_value()})
    if not response.is_success or response.json().get("broadcastEnabled") is not True:
        raise FinanceError("scoped Uniswap broadcast readiness is closed")


async def _finance_context(convex: ConvexWorkerClient, scope, controller: ControllerRef) -> str:
    value = await convex.command("getFinanceAuthorityContext",
        strategyAccountId=scope.strategy_account_id, environment="live", scopeId="live",
        controllerRef=controller.model_dump(mode="json"))
    if not isinstance(value, dict) or value.get("allowed") is not True \
            or value.get("reason") != "ready_for_financial_review" \
            or value.get("controllerMode") != "autopilot" \
            or value.get("scope") != {"environment": "live", "scopeId": "live",
                                        "strategyAccountId": scope.strategy_account_id} \
            or value.get("controllerRef") != controller.model_dump(mode="json"):
        raise FinanceError("managed financial authority changed")
    fingerprint = value.get("authorityFingerprint")
    if not isinstance(fingerprint, str) or len(fingerprint) != 64 \
            or any(char not in "0123456789abcdef" for char in fingerprint):
        raise FinanceError("managed financial authority fingerprint is invalid")
    return fingerprint


def _broadcast_input(native: dict, scope, context: dict, trade_intent: str,
                     client_id: str, quote: UniswapV3Quote, deadline: int) -> dict:
    return {"grantId": native["executionGrantId"], "scope": "buy",
        "strategyAccountId": scope.strategy_account_id,
        "assignmentId": context["programAssignmentId"], "intentId": trade_intent,
        "idempotencyKey": client_id, "amountIn": quote.amount_in,
        "amountOutMinimum": quote.minimum_amount_out, "deadline": deadline}


async def _reconcile_context(settings, proposal_id: str, command_id: str) -> dict:
    endpoint = _activation_url(settings.convex_worker_url, "context").replace(
        "/native-finance-activation/context", "/native-finance-trade/reconcile-context")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(endpoint,
            json={"proposalId": proposal_id, "commandId": command_id},
            headers={"Authorization": "Bearer " + settings.worker_shared_secret.get_secret_value()})
    if not response.is_success:
        raise FinanceError("managed reconciliation context is unavailable")
    value = response.json()
    if not isinstance(value, dict) or value.get("authority") != "reconciliation_only":
        raise FinanceError("managed reconciliation context is not limited to recovery")
    return value


async def _recover_existing(finance, convex, settings, proposal_id: str,
                            command_id: str, context: dict) -> dict:
    row = context["proposal"]
    controller = ControllerRef.model_validate(context["controllerRef"])
    proposal = TradeProposal.model_validate(row["payload"])
    if row["_id"] != proposal_id or row["idempotencyKey"] != command_id \
            or row["status"] not in {"executing", "executed"} \
            or row["controllerRef"] != controller.model_dump(mode="json") \
            or controller.environment != "live" or controller.controllerKind != "managed_program" \
            or controller.strategyAccountId != row["strategyAccountId"] \
            or proposal.account_id != row["strategyAccountId"] \
            or proposal.candidate_venues != ["uniswap"]:
        raise FinanceError("historical proposal is not the scoped managed buy")
    scope = FinanceScope(environment="live", scope_id="live",
                         strategy_account_id=controller.strategyAccountId)
    trade_intent = intent_id(scope, proposal_id)
    existing = await existing_trade(finance, scope, trade_intent)
    binding = await load_attempt_binding(finance, scope, trade_intent)
    if not existing or not existing.get("attempt_id") or not binding \
            or binding["attempt_id"] != existing["attempt_id"] \
            or binding["reservation_id"] != existing["reservation_id"] \
            or binding["proposal_id"] != proposal_id or binding["command_id"] != command_id \
            or binding["assignment_id"] != context["programAssignmentId"] \
            or binding["program_version_id"] != context["programVersionId"] \
            or binding["controller_ref"] != controller.model_dump(mode="json"):
        raise FinanceError("historical proposal lacks an exact possible submission binding")
    quote = await _stored_quote(finance, existing, scope)
    if quote_evidence_hash(quote) != binding["quote_hash"] \
            or quote.amount_in != str(binding["amount_in"]) \
            or quote.minimum_amount_out != str(binding["amount_out_minimum"]):
        raise FinanceError("historical managed quote differs from committed attempt")
    if binding.get("vault_address"):
        from .managed_vault_buy_helpers import recover_vault_buy
        return await recover_vault_buy(finance, settings, scope, context=context,
            reservation=existing, binding=binding, quote=quote)
    native = {"executionGrantId": binding["grant_id"],
              "ownerAddress": binding["owner_address"]}
    epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
    return await _reconcile_or_pending(finance, convex, settings, scope, native,
        context, row, existing, quote, trade_intent, command_id, epoch)


async def _stored_quote(finance, existing: dict, scope) -> UniswapV3Quote:
    async with finance.engine.connect() as conn:
        row = (await conn.execute(text("""
          SELECT receipt_json FROM finance_calculation_receipts
          WHERE environment='live' AND scope_id='live' AND strategy_account_id=:account
            AND receipt_hash=:hash
        """), {"account": scope.strategy_account_id,
               "hash": existing["calculation_receipt_hash"]})).mappings().first()
        if row is None:
            raise FinanceError("existing reservation calculation receipt is unavailable")
        receipt = SizingReceipt.model_validate(row["receipt_json"])
        if receipt.receipt_hash != existing["calculation_receipt_hash"]:
            raise FinanceError("existing reservation receipt differs")
        return await load_uniswap_quote(conn, receipt.price_snapshot_hash)


async def _reconcile_or_pending(finance, convex, settings, scope, native, context,
                                row, existing, quote, trade_intent, client_id, epoch):
    grant = native["executionGrantId"]
    outcome = await _sidecar("scoped-reconcile", {"grantId": grant, "scope": "buy"})
    if not outcome:
        return {"status": "uncertain", "reason": "sidecar_operation_not_yet_visible",
                "reservationId": existing["reservation_id"]}
    if outcome.get("grantId") != grant or outcome.get("scope") != "buy" \
            or outcome.get("intentId") != trade_intent \
            or outcome.get("idempotencyKey") != client_id:
        raise FinanceError("sidecar operation differs from durable finance attempt")
    if outcome.get("state") != "confirmed":
        if outcome.get("state") in {"submitting", "submitted", "uncertain"} \
                and existing["status"] == "submitted":
            state = await current_account(finance, scope)
            await finance.mark_submission_uncertain(scope, existing["reservation_id"], epoch,
                int(state["revision"]), "native-uniswap-uncertain:" + trade_intent)
        return {"status": "executing", "sidecarState": outcome.get("state", "unknown"),
                "reservationId": existing["reservation_id"]}
    try:
        proof = await settle_confirmed_buy(finance, scope=scope, native=native,
            proposal_id=row["_id"], context=context, reservation=existing,
            quote=quote, operation=outcome, writer_epoch=epoch, sidecar=_sidecar)
    except FinanceError:
        return {"status": "executing", "reason": "confirmed_native_fill_awaiting_finance_reconciliation",
                "reservationId": existing["reservation_id"]}
    payload = {"proposalId": row["_id"], "strategyAccountId": scope.strategy_account_id,
        "assignmentId": context["programAssignmentId"],
        "programVersionId": context["programVersionId"], "intentId": trade_intent,
        "attemptId": existing["attempt_id"], "reservationId": existing["reservation_id"],
        "grantId": grant, "userOperationHash": outcome["userOperationHash"],
        "transactionHash": outcome["transactionHash"],
        "confirmedBlockNumber": outcome["confirmedBlockNumber"],
        "confirmedBlockHash": outcome["confirmedBlockHash"],
        "postFillSnapshotHash": proof["snapshotHash"],
        "financeRevision": str(proof["revision"]),
        "journalTransactionId": proof["transactionId"],
        "actualInputUnits": outcome["actualInputUnits"],
        "actualOutputUnits": outcome["actualOutputUnits"]}
    endpoint = _activation_url(settings.convex_worker_url, "confirmed") \
        .replace("/native-finance-activation/confirmed", "/native-finance-trade/confirmed")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(endpoint, json=payload,
            headers={"Authorization": "Bearer " + settings.worker_shared_secret.get_secret_value()})
    if not response.is_success:
        return {"status": "executing", "reason": "finance_confirmed_convex_projection_pending",
                "reservationId": existing["reservation_id"], **proof}
    result = response.json()
    if not isinstance(result, dict) or not result.get("receiptId") or not result.get("executionId"):
        return {"status": "executing", "reason": "convex_confirmation_receipt_invalid",
                "reservationId": existing["reservation_id"], **proof}
    return {"status": "executed", "reservationId": existing["reservation_id"],
            "finance": proof, "convexReceiptId": result["receiptId"]}


from .managed_uniswap_buy_route import router  # re-export for API registration
