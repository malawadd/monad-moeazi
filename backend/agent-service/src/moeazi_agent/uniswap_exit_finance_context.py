"""Check a stopped finance exit against the current owner-scoped close identity."""
from __future__ import annotations

import httpx

from .config import get_settings


async def verify_stopped_managed_uniswap_exit(marker: dict, *, strategy_account_id: str,
        assignment_id: str, grant_id: str) -> dict | None:
    settings = get_settings()
    worker_url = settings.convex_worker_url
    subject = marker.get("customerSubject")
    source = marker.get("sourceAccountId")
    if not worker_url.endswith("/worker") or not isinstance(subject, str) or not subject \
            or not isinstance(source, str) or not source.startswith("arbitrum:42161:wallet:"):
        return None
    url = worker_url.removesuffix("/worker") + "/native-finance-trade/close-context"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.post(url,
                headers={"Authorization": "Bearer " + settings.worker_shared_secret.get_secret_value()},
                json={"assignmentId": assignment_id, "subject": subject})
            response.raise_for_status()
            context = response.json()
        if not isinstance(context, dict) or context.get("authority") != "reduce_only_close" \
                or context.get("customerSubject") != subject \
                or context.get("strategyAccountId") != strategy_account_id \
                or context.get("assignmentId") != assignment_id \
                or context.get("executionGrantId") != grant_id \
                or context.get("ownerAddress") != source.removeprefix("arbitrum:42161:wallet:") \
                or context.get("sourceAccountId") != source \
                or context.get("programVersionId") != marker.get("reservationControllerRef", {}).get(
                    "controllerVersionId") \
                or context.get("controllerRef") != marker.get("reservationControllerRef") \
                or "0x" + context.get("frozenProgramPolicyHash", "") != marker.get(
                    "frozenProgramPolicyHash"):
            return None
        return {"grantId": grant_id, "assignmentId": assignment_id,
                "frozenProgramPolicyHash": marker["frozenProgramPolicyHash"]}
    except (httpx.HTTPError, KeyError, TypeError, ValueError, RuntimeError):
        return None
