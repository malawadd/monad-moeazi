"""Bind a stored finance submission to the current managed program and owner grant."""
from __future__ import annotations

import httpx

from .config import get_settings
from .convex import ConvexWorkerClient


def _controller_matches(marker: dict, context: dict, assignment_id: str,
                        strategy_account_id: str) -> bool:
    ref = marker.get("reservationControllerRef")
    return isinstance(ref, dict) and ref.get("schemaVersion") == 1 \
        and ref.get("environment") == "live" \
        and ref.get("strategyAccountId") == strategy_account_id \
        and ref.get("controllerKind") == "managed_program" \
        and ref.get("controllerId") == assignment_id \
        and ref.get("controllerVersionId") == context.get("programVersionId") \
        and ref.get("contentHash") == context.get("contentHash")


async def verify_current_managed_uniswap_marker(
    marker: dict, *, strategy_account_id: str, assignment_id: str, grant_id: str,
) -> dict | None:
    """The DB marker alone cannot prove the current frozen program or grant binding."""
    settings = get_settings()
    worker_url = settings.convex_worker_url
    if not worker_url.endswith("/worker"):
        return None
    context_url = worker_url.removesuffix("/worker") + "/native-finance-activation/context"
    headers = {"Authorization": f"Bearer {settings.worker_shared_secret.get_secret_value()}"}
    try:
        async with httpx.AsyncClient(timeout=5) as http:
            response = await http.post(context_url, headers=headers,
                json={"assignmentId": assignment_id, "executionGrantId": grant_id})
            response.raise_for_status()
            context = response.json()
        if not isinstance(context, dict) or context.get("financialAuthority") != "identity_only" \
                or context.get("strategyAccountId") != strategy_account_id \
                or context.get("assignmentId") != assignment_id \
                or context.get("executionGrantId") != grant_id \
                or context.get("venue") != "uniswap" \
                or marker.get("strategyAccountId") != strategy_account_id \
                or marker.get("sourceAccountId") != context.get("sourceAccountId") \
                or not _controller_matches(marker, context, assignment_id, strategy_account_id):
            return None
        frozen = context.get("policyHash")
        if not isinstance(frozen, str) or len(frozen) != 64 \
                or any(char not in "0123456789abcdef" for char in frozen):
            return None
        convex = ConvexWorkerClient(settings)
        try:
            authority = await convex.command("getFinanceAuthorityContext",
                strategyAccountId=strategy_account_id, environment="live", scopeId="live",
                controllerRef=marker["reservationControllerRef"])
        finally:
            await convex.client.aclose()
        if not isinstance(authority, dict) or authority.get("allowed") is not True \
                or authority.get("reason") != "ready_for_financial_review" \
                or authority.get("controllerMode") != "autopilot" \
                or authority.get("authorityFingerprint") != marker.get("authorityFingerprint"):
            return None
        return {"grantId": grant_id, "assignmentId": assignment_id,
                "frozenProgramPolicyHash": f"0x{frozen}"}
    except (httpx.HTTPError, KeyError, TypeError, ValueError, RuntimeError):
        return None
