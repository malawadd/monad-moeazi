"""Read-only Temporal status for an owner-scoped mobile schedule projection."""
from hmac import compare_digest
import asyncio
import time

from fastapi import APIRouter, Header, HTTPException, Request
import httpx
from temporalio.client import WorkflowExecutionStatus
from temporalio.service import RPCError, RPCStatusCode

from .config import get_settings
from .convex import ConvexWorkerClient
from .schedule_manager import managed_schedule_id


router = APIRouter()
_provider_health: tuple[float, tuple[str, ...], str] | None = None
_provider_health_lock = asyncio.Lock()


def lite_route_providers(context: dict | None) -> tuple[str, ...]:
    """Resolve only the two specialists Lite Mode actually calls."""
    routes = ((context or {}).get("modelConfiguration") or {}).get("routes") or {}
    by_slot = {item.get("slot"): item for item in routes.get("routes", [])
        if isinstance(item, dict)}
    default = by_slot.get("specialist_default") or {}
    selected = [by_slot.get(f"role:{role}") or default
        for role in ("technical_trend", "liquidity")]
    return tuple(sorted({item.get("provider") for item in selected
        if item.get("provider") in {"deepseek", "openai", "openrouter"}}))


async def lite_provider_health(settings, providers: tuple[str, ...]) -> str:
    """Read only selected-provider availability; never expose balance or credentials."""
    global _provider_health
    async with _provider_health_lock:
        now = time.monotonic()
        if _provider_health and _provider_health[1] == providers and now - _provider_health[0] < 60:
            return _provider_health[2]
        status = "unknown"
        if providers == ("deepseek",):
            secret = settings.deepseek_api_key.get_secret_value()
            if not secret:
                status = "unavailable"
            else:
                try:
                    async with httpx.AsyncClient(timeout=8) as client:
                        response = await client.get("https://api.deepseek.com/user/balance",
                            headers={"Authorization": f"Bearer {secret}"})
                    balance = response.json() if response.is_success else {}
                    value = balance.get("is_available")
                    status = "available" if value is True else "unavailable" if value is False else "unknown"
                except (httpx.HTTPError, ValueError):
                    pass
        elif providers == ("openrouter",):
            secret = settings.openrouter_api_key.get_secret_value()
            if not secret:
                status = "unavailable"
            else:
                try:
                    async with httpx.AsyncClient(timeout=8) as client:
                        response = await client.get("https://openrouter.ai/api/v1/key",
                            headers={"Authorization": f"Bearer {secret}"})
                    remaining = ((response.json().get("data") or {}).get("limit_remaining")
                        if response.is_success else None)
                    status = ("available" if isinstance(remaining, (int, float)) and remaining > 0
                        else "unavailable" if remaining == 0 or response.status_code in {401, 402}
                        else "unknown")
                except (httpx.HTTPError, ValueError):
                    pass
        _provider_health = (now, providers, status)
        return status


async def recent_check(temporal, market: str, action) -> dict | None:
    workflow_id = getattr(action.action, "workflow_id", None)
    if not workflow_id:
        return None
    handle = temporal.get_workflow_handle(workflow_id)
    try:
        description = await handle.describe()
        state = description.status
        result = (await asyncio.wait_for(handle.result(), timeout=2)
                  if state == WorkflowExecutionStatus.COMPLETED else None)
    except (RPCError, asyncio.TimeoutError):
        return None
    return {"market": market, "workflowId": workflow_id,
            "startedAt": action.started_at.isoformat(),
            "status": result.get("status", "completed") if isinstance(result, dict)
                else state.name.lower(),
            "reason": result.get("reason") if isinstance(result, dict) else None}


@router.get("/v1/schedules/managed-status")
async def managed_schedule_status(request: Request, assignment_id: str,
                                  authorization: str | None = Header(default=None)):
    settings = get_settings()
    expected = f"Bearer {settings.worker_shared_secret.get_secret_value()}"
    if not authorization or not compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Worker authorization required")
    if not assignment_id or len(assignment_id) > 80:
        raise HTTPException(status_code=400, detail="Managed assignment ID is invalid")
    binding = await ConvexWorkerClient(settings).command(
        "getAgentScheduleProfile", assignmentId=assignment_id)
    if not binding or binding.get("assignmentId") != assignment_id:
        raise HTTPException(status_code=404, detail="Managed assignment not found")
    controls = await request.app.state.runtime_controls.get()
    markets = binding.get("markets") or []
    wanted = list(dict.fromkeys(str(market).upper() for market in
                                (markets[:1] if controls.lite_mode else markets)))
    states = []
    recent = []
    for market in wanted:
        handle = request.app.state.temporal.get_schedule_handle(
            managed_schedule_id(assignment_id, market))
        try:
            description = await handle.describe()
        except RPCError as exc:
            if exc.status == RPCStatusCode.NOT_FOUND:
                states.append({"market": market, "exists": False,
                               "paused": False, "nextRunAt": None})
                continue
            raise
        next_times = description.info.next_action_times
        states.append({"market": market, "exists": True,
                       "paused": description.schedule.state.paused,
                       "nextRunAt": next_times[0].isoformat() if next_times else None})
        recent.extend(check for check in await asyncio.gather(*(
            recent_check(request.app.state.temporal, market, action)
            for action in description.info.recent_actions[-3:])) if check)
    active = bool(binding.get("active") and states and
                  all(row["exists"] and not row["paused"] for row in states))
    next_times = [row["nextRunAt"] for row in states if row["nextRunAt"]]
    provider_status = "unknown"
    if controls.lite_mode and active:
        try:
            context = await ConvexWorkerClient(settings).command("getAgentScheduleProfile",
                assignmentId=binding["assignmentId"], programVersionId=binding["programVersionId"],
                marketId=wanted[0], scheduleRevision=binding["scheduleRevision"],
                controllerRef=binding["controllerRef"])
            provider_status = await lite_provider_health(settings, lite_route_providers(context))
        except Exception:
            pass
    return {"active": active, "markets": states,
            "nextRunAt": min(next_times) if next_times else None,
            "recentChecks": sorted(recent, key=lambda row: row["startedAt"], reverse=True)[:10],
            "analysisProviderStatus": provider_status}
