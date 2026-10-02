from datetime import timedelta

from temporalio.client import (
    Client,
    Schedule,
    ScheduleActionStartWorkflow,
    ScheduleIntervalSpec,
    ScheduleSpec,
    ScheduleState,
    ScheduleUpdate,
)

from .config import Settings
from .controller_contracts import require_customer_binding, require_managed_program_binding
from .runtime_controls import RuntimeControls
from .temporal_app import ScheduledAnalysisWorkflow


CADENCE_MINUTES = {"1m": 1, "2m": 2, "5m": 5, "15m": 15}
PREFIX = "agent-market-"
MANAGED_PREFIX = "managed-program-"


def schedule_id(profile_id: str, market: str) -> str:
    safe_market = "".join(char.lower() if char.isalnum() else "-" for char in market)
    return f"{PREFIX}{profile_id}-{safe_market}"[:240]


def managed_schedule_id(assignment_id: str, market: str) -> str:
    safe_market = "".join(char.lower() if char.isalnum() else "-" for char in market)
    return f"{MANAGED_PREFIX}{assignment_id}-{safe_market}"[:240]


def schedule_for(
    profile: dict,
    market: str,
    controls: RuntimeControls,
    settings: Settings,
    controller_ref: dict | None = None,
) -> Schedule:
    cadence = CADENCE_MINUTES[profile["cadence"]]
    if controls.lite_mode:
        cadence = max(15, cadence)
    identifier = schedule_id(profile["_id"], market)
    return Schedule(
        action=ScheduleActionStartWorkflow(
            ScheduledAnalysisWorkflow.run,
            {
                "profile_id": profile["_id"],
                "market": market,
                "schedule_revision": profile.get("scheduleRevision", 0),
                "task_queue": settings.temporal_task_queue,
                **({"controllerRef": controller_ref} if controller_ref else {}),
            },
            id=identifier,
            task_queue=settings.temporal_task_queue,
        ),
        spec=ScheduleSpec(
            intervals=[ScheduleIntervalSpec(every=timedelta(minutes=cadence))],
        ),
        state=ScheduleState(
            paused=controls.manual_guard,
            note="Manual Guard is on" if controls.manual_guard else "Automatic cadence enabled",
        ),
    )


async def sync_profile_schedules(
    client: Client,
    profile_data: dict,
    controls: RuntimeControls,
    settings: Settings,
) -> dict:
    profile = profile_data["profile"]
    markets = profile_data.get("markets", [])
    wanted = set(markets[:1] if controls.lite_mode else markets)
    active = (
        profile.get("lifecycleStatus") == "active"
        and not profile.get("paused", True)
        and profile.get("cadence") in CADENCE_MINUTES
    )
    synced = 0
    for market in wanted:
        handle = client.get_schedule_handle(schedule_id(profile["_id"], market))
        deployments = [item for item in profile_data.get("deployments", [])
            if item.get("marketId") == market and item.get("status") == "active"]
        if not active or len(deployments) != 1 or not deployments[0].get("controllerRef"):
            try:
                await handle.delete()
            except Exception:
                pass
            continue
        deployment = deployments[0]
        ref = require_customer_binding({
            "controllerRef": deployment["controllerRef"],
            "strategyAccountId": profile["strategyAccountId"], "teamId": profile["_id"],
            "teamVersionId": deployment["teamVersionId"], "deploymentId": deployment["_id"],
        }, deployment["controllerRef"], team_id=profile["_id"])
        schedule = schedule_for(profile, market, controls, settings, ref.model_dump())
        try:
            await handle.update(lambda _: ScheduleUpdate(schedule=schedule))
        except Exception:
            await client.create_schedule(schedule_id(profile["_id"], market), schedule)
        synced += 1
    return {"synced": synced, "paused": controls.manual_guard}


def managed_schedule_for(binding: dict, market: str, controls: RuntimeControls,
                         settings: Settings, controller_ref: dict) -> Schedule:
    cadence = CADENCE_MINUTES[binding["cadence"]]
    if controls.lite_mode:
        cadence = max(15, cadence)
    assignment_id = binding["assignmentId"]
    version_id = binding["programVersionId"]
    revision = binding["scheduleRevision"]
    identifier = managed_schedule_id(assignment_id, market)
    return Schedule(
        action=ScheduleActionStartWorkflow(
            ScheduledAnalysisWorkflow.run,
            {
                "managed_program": True,
                "program_assignment_id": assignment_id,
                "program_version_id": version_id,
                "schedule_revision": revision,
                "controllerRef": controller_ref,
                "controller_mode": binding["controllerMode"],
                "market": market,
                "cadence_minutes": cadence,
                "task_queue": settings.temporal_task_queue,
            },
            id=identifier,
            task_queue=settings.temporal_task_queue,
        ),
        spec=ScheduleSpec(intervals=[ScheduleIntervalSpec(every=timedelta(minutes=cadence))]),
        state=ScheduleState(
            paused=controls.manual_guard,
            note="Manual Guard is on" if controls.manual_guard else "Managed cadence enabled",
        ),
    )


async def _delete_managed_schedules(client: Client, assignment_id: str) -> int:
    prefix = f"{MANAGED_PREFIX}{assignment_id}-"
    deleted = 0
    async for entry in await client.list_schedules():
        if entry.id.startswith(prefix):
            try:
                await client.get_schedule_handle(entry.id).delete()
                deleted += 1
            except Exception:
                pass
    return deleted


async def sync_managed_program_schedules(
    client: Client, binding: dict, controls: RuntimeControls, settings: Settings,
) -> dict:
    assignment_id = str(binding.get("assignmentId", ""))
    if not assignment_id:
        return {"synced": 0, "deleted": 0, "paused": controls.manual_guard}
    if not binding.get("active"):
        deleted = await _delete_managed_schedules(client, assignment_id)
        return {"synced": 0, "deleted": deleted, "paused": controls.manual_guard}

    version_id = str(binding.get("programVersionId", ""))
    revision = binding.get("scheduleRevision")
    markets = binding.get("markets")
    if (not version_id or not isinstance(revision, int) or not isinstance(markets, list)
            or binding.get("cadence") not in CADENCE_MINUTES):
        deleted = await _delete_managed_schedules(client, assignment_id)
        return {"synced": 0, "deleted": deleted, "paused": controls.manual_guard}
    try:
        ref = require_managed_program_binding({
            "controllerRef": binding.get("controllerRef"),
            "strategyAccountId": binding.get("strategyAccountId"),
            "programAssignmentId": assignment_id, "programVersionId": version_id,
        }, binding.get("controllerRef"), assignment_id=assignment_id,
            program_version_id=version_id, content_hash=str(binding["controllerRef"]["contentHash"]))
        if binding.get("controllerMode") not in {"shadow", "autopilot"}:
            raise ValueError("Managed schedule mode is unavailable")
    except (KeyError, TypeError, ValueError):
        deleted = await _delete_managed_schedules(client, assignment_id)
        return {"synced": 0, "deleted": deleted, "paused": controls.manual_guard}

    wanted = list(dict.fromkeys(str(item).upper() for item in (markets[:1] if controls.lite_mode else markets)))
    wanted_ids = {managed_schedule_id(assignment_id, market) for market in wanted}
    synced = 0
    for market in wanted:
        schedule = managed_schedule_for(binding, market, controls, settings, ref.model_dump())
        handle = client.get_schedule_handle(managed_schedule_id(assignment_id, market))
        try:
            await handle.update(lambda _: ScheduleUpdate(schedule=schedule))
        except Exception:
            await client.create_schedule(managed_schedule_id(assignment_id, market), schedule)
        synced += 1

    deleted = 0
    prefix = f"{MANAGED_PREFIX}{assignment_id}-"
    async for entry in await client.list_schedules():
        if entry.id.startswith(prefix) and entry.id not in wanted_ids:
            try:
                await client.get_schedule_handle(entry.id).delete()
                deleted += 1
            except Exception:
                pass
    return {"synced": synced, "deleted": deleted, "paused": controls.manual_guard}


async def set_agent_schedules_paused(client: Client, paused: bool) -> int:
    changed = 0
    async for entry in await client.list_schedules():
        if not (entry.id.startswith(PREFIX) or entry.id.startswith(MANAGED_PREFIX)):
            continue
        handle = client.get_schedule_handle(entry.id)
        if paused:
            await handle.pause(note="Manual Guard is on")
        else:
            await handle.unpause(note="Manual Guard is off")
        changed += 1
    return changed
