"""Verify Magic's owner-only return, fold the live journal, then close the mandate."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import Field

from .config import get_settings
from .finance_contracts import FinanceError, StrictFinanceModel
from .finance_routes import _subject, _viewer_scope
from .managed_vault_buy_helpers import vault_sidecar
from .managed_vault_release_settlement import settle_vault_owner_release


router = APIRouter(prefix="/v1/finance/managed-program",
                   tags=["managed Magic vault return"])


class VaultReleaseRequest(StrictFinanceModel):
    mandate_id: str = Field(alias="mandateId", min_length=1, max_length=256)


async def _convex(settings, operation: str, payload: dict) -> dict:
    worker = settings.convex_worker_url.rstrip("/")
    if not worker.endswith("/worker"):
        raise FinanceError("Convex vault return authority is unavailable")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(worker.removesuffix("/worker")
            + "/native-vault-release/" + operation, json=payload,
            headers={"Authorization": "Bearer "
                + settings.worker_shared_secret.get_secret_value()})
    if not response.is_success:
        raise FinanceError("owned Magic vault return context is unavailable")
    data = response.json()
    if not isinstance(data, dict):
        raise FinanceError("Magic vault return authority returned no context")
    return data


@router.post("/release-vault")
async def release_magic_vault(body: VaultReleaseRequest, request: Request,
        authorization: str | None = Header(default=None),
        x_moeazi_subject: str | None = Header(default=None)):
    subject = _subject(authorization, x_moeazi_subject)
    scope = await _viewer_scope(subject, "live", None)
    settings = get_settings()
    finance = getattr(request.app.state, "finance", None)
    if finance is None:
        raise HTTPException(status_code=503, detail="Native finance writer is unavailable")
    try:
        context = await _convex(settings, "context", {
            "mandateId": body.mandate_id, "subject": subject})
        if (context.get("customerSubject") != subject
                or context.get("strategyAccountId") != scope.strategy_account_id
                or context.get("mandateId") != body.mandate_id):
            raise FinanceError("Magic owner or vault mandate changed")
        expectation = {key: context[key] for key in ("vaultAddress", "ownerAddress",
            "executorAddress", "codeHash", "programHash", "policyHash",
            "capitalUnits", "maxBuyUnits", "expiresAt", "fromBlock")}
        operation = await vault_sidecar(settings,
            "managed-vault-observe-release", expectation)
        if operation.get("status") == "pending":
            return {"status": "pending", "code": "VAULT_RETURN_AWAITING_FINALITY"}
        if operation.get("status") != "confirmed":
            raise FinanceError("finalized Magic vault transfer proof is unavailable")
        settled = await settle_vault_owner_release(finance, settings,
            context=context, operation=operation)
        await _convex(settings, "confirm", {"mandateId": body.mandate_id,
            "ownerAddress": context["ownerAddress"],
            **{key: settled[key] for key in ("transactionHash", "amountUnits",
                "finalizedBlockNumber", "finalizedBlockHash",
                "financeSnapshotHash", "journalTransactionId")}})
        return {"status": "confirmed", "code": "MAGIC_VAULT_RETURN_RECONCILED",
            **settled}
    except FinanceError as exc:
        raise HTTPException(status_code=409, detail={"status": "blocked",
            "code": "VAULT_RETURN_UNAVAILABLE", "message": str(exc)}) from exc
