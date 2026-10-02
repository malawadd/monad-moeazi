"""Authenticated financial reads; no caller-controlled live account or journal writes."""
from __future__ import annotations

from hmac import compare_digest
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Query, Request

from .config import get_settings
from .convex import ConvexWorkerClient
from .finance_contracts import FinanceError, FinanceScope


router = APIRouter(prefix="/v1/finance", tags=["financial state"])


def _subject(authorization: str | None, subject: str | None) -> str:
    secret = get_settings().worker_shared_secret.get_secret_value()
    if not authorization or not compare_digest(authorization.encode(), f"Bearer {secret}".encode()) \
            or not subject or len(subject) > 512:
        raise HTTPException(status_code=401, detail="Authenticated financial access is required.")
    return subject


async def _viewer_scope(subject: str, environment: str,
                        experiment_spec_id: str | None) -> FinanceScope:
    if (environment == "experiment") != bool(experiment_spec_id):
        raise HTTPException(status_code=422, detail="Select a valid financial environment.")
    client = ConvexWorkerClient(get_settings())
    try:
        arguments = {"subject": subject, "environment": environment}
        if experiment_spec_id is not None:
            arguments["experimentSpecId"] = experiment_spec_id
        context = await client.command("getViewerFinanceScope", **arguments)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Financial ownership is unavailable.") from exc
    finally:
        await client.client.aclose()
    if not context:
        raise HTTPException(status_code=404, detail="Financial scope is unavailable.")
    try:
        resolved = context["scope"]
        scope = FinanceScope(environment=resolved["environment"],
            scope_id=resolved["scopeId"], strategy_account_id=resolved["strategyAccountId"])
        if scope.environment != environment \
                or scope.scope_id != (experiment_spec_id or "live"):
            raise ValueError("Resolved scope does not match requested environment")
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="Financial ownership could not be verified.") from exc
    return scope


@router.get("/snapshot")
async def snapshot(
    request: Request,
    environment: Literal["live", "experiment"] = Query(default="live"),
    experiment_spec_id: str | None = Query(default=None, alias="experimentSpecId", max_length=160),
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = _subject(authorization, x_moeazi_subject)
    scope = await _viewer_scope(subject, environment, experiment_spec_id)
    try:
        state = await request.app.state.finance.read_account_risk_snapshot(scope)
    except FinanceError:
        return {"status": "unknown", "snapshot": None, "reason": "financial_state_unavailable",
                "authority": "financial_review_only", "executionQualified": False}
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Financial state is unavailable.") from exc
    return {"status": state["reconciliationState"], "snapshot": state,
            "authority": "financial_review_only", "executionQualified": False}


@router.get("/withdrawable")
async def withdrawable(
    request: Request,
    asset_unit_id: str = Query(alias="assetUnitId", min_length=1, max_length=256),
    location_id: str = Query(alias="locationId", min_length=1, max_length=256),
    environment: Literal["live", "experiment"] = Query(default="live"),
    experiment_spec_id: str | None = Query(default=None, alias="experimentSpecId", max_length=160),
    authorization: str | None = Header(default=None),
    x_moeazi_subject: str | None = Header(default=None),
):
    subject = _subject(authorization, x_moeazi_subject)
    scope = await _viewer_scope(subject, environment, experiment_spec_id)
    try:
        state = await request.app.state.finance.read_withdrawable_balance(scope, asset_unit_id, location_id)
    except FinanceError:
        state = {"status": "unknown", "units": None, "reason": "financial_state_unavailable"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Financial state is unavailable.") from exc
    return {**state, "authority": "financial_review_only", "executionQualified": False}
