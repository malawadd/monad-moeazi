"""Customer Stop reaches the exact Magic-owned vault without exposing its signer."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import Field

from .config import get_settings
from .finance_contracts import FinanceError, StrictFinanceModel
from .finance_routes import _subject, _viewer_scope
from .managed_vault_buy_helpers import vault_sidecar


router = APIRouter(prefix="/v1/finance/managed-program",
                   tags=["managed Magic vault stop"])


class VaultStopRequest(StrictFinanceModel):
    mandate_id: str = Field(alias="mandateId", min_length=1, max_length=256)
    assignment_id: str = Field(alias="assignmentId", min_length=1, max_length=256)


async def _convex(settings, operation: str, payload: dict) -> dict:
    worker = settings.convex_worker_url.rstrip("/")
    if not worker.endswith("/worker"):
        raise FinanceError("Convex vault stop authority is unavailable")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(worker.removesuffix("/worker")
            + "/native-vault-stop/" + operation, json=payload,
            headers={"Authorization": "Bearer "
                + settings.worker_shared_secret.get_secret_value()})
    if not response.is_success:
        raise FinanceError("owned Magic vault stop context is unavailable")
    data = response.json()
    if not isinstance(data, dict):
        raise FinanceError("Magic vault stop authority returned no context")
    return data


def _expectation(context: dict) -> dict:
    return {key: context[key] for key in ("vaultAddress", "ownerAddress",
        "executorAddress", "codeHash", "programHash", "policyHash",
        "capitalUnits", "maxBuyUnits", "expiresAt")}


def _pending(code: str, *, transaction_hash: str | None = None) -> dict:
    return {"status": "pending", "code": code,
        "onChainStopConfirmed": False,
        "transactionHash": transaction_hash,
        "positionClosure": "unconfirmed",
        "submittedOperationMayStillSettle": True}


@router.post("/stop-vault")
async def stop_magic_vault(body: VaultStopRequest, request: Request,
        authorization: str | None = Header(default=None),
        x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    scope = await _viewer_scope(subject, "live", None)
    settings = get_settings()
    try:
        context = await _convex(settings, "context", {
            "mandateId": body.mandate_id, "subject": subject})
        if (context.get("customerSubject") != subject
                or context.get("strategyAccountId") != scope.strategy_account_id
                or context.get("assignmentId") != body.assignment_id
                or context.get("mandateId") != body.mandate_id):
            raise FinanceError("Magic owner, mandate or managed assignment changed")
        expected = _expectation(context)
        read = await vault_sidecar(settings, "managed-vault-read", expected)
        if (read.get("vaultAddress", "").lower() != expected["vaultAddress"]
                or read.get("ownerAddress", "").lower() != expected["ownerAddress"]):
            raise FinanceError("Finalized vault differs from the Magic owner")
        if read.get("stopped") is True:
            if not context.get("stopState"):
                await _convex(settings, "claim", {"mandateId": body.mandate_id})
            await _convex(settings, "outcome", {"mandateId": body.mandate_id,
                "state": "confirmed",
                "finalizedBlockNumber": read["finalizedBlockNumber"],
                "finalizedBlockHash": read["finalizedBlockHash"]})
            return {"status": "confirmed", "code": "FINALIZED_VAULT_STOP",
                "onChainStopConfirmed": True, "vaultAddress": expected["vaultAddress"],
                "finalizedBlockNumber": read["finalizedBlockNumber"],
                "finalizedBlockHash": read["finalizedBlockHash"],
                "positionClosure": "unconfirmed",
                "submittedOperationMayStillSettle": True}
        if context.get("stopState"):
            return _pending("VAULT_STOP_AWAITING_FINALITY",
                transaction_hash=context.get("stopTransactionHash"))
        readiness = await vault_sidecar(settings,
            "managed-vault-stop-readiness", expected, private=True)
        if readiness.get("ready") is not True:
            raise FinanceError("isolated Magic vault stop signer is unavailable")
        claimed = await _convex(settings, "claim", {"mandateId": body.mandate_id})
        if claimed.get("claimed") is not True:
            return _pending("VAULT_STOP_ALREADY_CLAIMED")
        try:
            sent = await vault_sidecar(settings, "managed-vault-stop",
                expected, private=True, timeout=45)
        except Exception:
            await _convex(settings, "outcome", {"mandateId": body.mandate_id,
                "state": "uncertain"})
            return _pending("VAULT_STOP_SUBMISSION_UNCERTAIN")
        if sent.get("status") == "confirmed":
            await _convex(settings, "outcome", {"mandateId": body.mandate_id,
                "state": "confirmed",
                "finalizedBlockNumber": sent["finalizedBlockNumber"],
                "finalizedBlockHash": sent["finalizedBlockHash"]})
            return {"status": "confirmed", "code": "FINALIZED_VAULT_STOP",
                "onChainStopConfirmed": True, "vaultAddress": expected["vaultAddress"],
                "finalizedBlockNumber": sent["finalizedBlockNumber"],
                "finalizedBlockHash": sent["finalizedBlockHash"],
                "positionClosure": "unconfirmed",
                "submittedOperationMayStillSettle": True}
        if sent.get("status") != "submitted" or not sent.get("transactionHash"):
            raise FinanceError("vault stop returned no submitted transaction identity")
        await _convex(settings, "outcome", {"mandateId": body.mandate_id,
            "state": "submitted", "transactionHash": sent["transactionHash"]})
        return _pending("VAULT_STOP_AWAITING_FINALITY",
            transaction_hash=sent["transactionHash"])
    except FinanceError as exc:
        raise HTTPException(status_code=409, detail={"status": "blocked",
            "code": "VAULT_STOP_UNAVAILABLE", "message": str(exc),
            "onChainStopConfirmed": False,
            "positionClosure": "unconfirmed"}) from exc
