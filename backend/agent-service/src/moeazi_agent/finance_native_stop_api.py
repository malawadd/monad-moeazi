"""Stop native financial admission for an authenticated mobile owner."""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from sqlalchemy import text

from .finance_contracts import FinanceError, _digest
from .finance_routes import _subject, _viewer_scope


router = APIRouter(prefix="/v1/finance", tags=["native finance stop"])


@router.post("/managed-program/stop-admission")
async def stop_managed_program_admission(
    request: Request,
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    """Revoke new finance reservations; in-flight native ops still need reconciliation."""
    subject = _subject(authorization, x_moeazi_subject)
    scope = await _viewer_scope(subject, "live", None)
    finance = getattr(request.app.state, "finance", None)
    if finance is None:
        raise HTTPException(status_code=503, detail="Native finance writer is unavailable")
    params = scope.model_dump()
    try:
        async with finance.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT revision,admission_state FROM finance_accounts
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), params)).mappings().first()
        if row is None:
            return {"nativeFinanceAdmissionStopped": True, "status": "not_registered",
                    "positionClosure": "unconfirmed"}
        if row["admission_state"] == "stopped":
            return {"nativeFinanceAdmissionStopped": True, "status": "stopped",
                    "positionClosure": "unconfirmed", "financeRevision": str(row["revision"])}
        epoch = await finance.acquire_writer_epoch(scope, "native-uniswap-activation-v1")
        digest = _digest("moeazi-finance-command-v1:set-stop", {
            "scope": params, "stopped": True})
        result = await finance.set_account_stop(scope, epoch, int(row["revision"]),
            stopped=True, idempotency_key=f"mobile-native-stop:{scope.strategy_account_id}:{row['revision']}",
            request_hash=digest)
        return {"nativeFinanceAdmissionStopped": result.get("state") == "stopped",
                "status": result.get("state"), "financeRevision": str(result.get("revision")),
                "authorityEpoch": str(result.get("authorityEpoch")),
                "positionClosure": "unconfirmed"}
    except FinanceError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Native finance stop could not be verified") from exc
