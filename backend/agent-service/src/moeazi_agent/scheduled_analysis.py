from temporalio import activity

from .config import get_settings
from .controller_contracts import customer_mode, require_customer_binding, require_customer_mode
from .program_contracts import require_managed_program_runtime
from .convex import ConvexWorkerClient
from .dependency_safety_boundaries import assess_analysis, frozen_time
from .evidence_lifecycle_contracts import LifecycleScope
from .evidence_lifecycle_evaluator import evaluate_persistence
from .evidence_lifecycle_storage import EvidenceLifecycleRepository
from .model_routing import ModelRouting, route_estimate
from .managed_vault_schedule_refresh import refresh_managed_vault_authority
from .roles import assignments_for_configuration, assignments_for_tier
from .runtime_controls import RuntimeControlStore
from .storage import AnalysisRepository


def managed_admission_payload(binding: dict, account_id: str) -> dict:
    # The lifecycle gate records admission facts, while the workflow and job keep
    # the full immutable controller reference. Its schema accepts these four keys.
    return {"account_id": account_id, "market": binding["marketId"],
            "profile_id": binding["assignmentId"],
            "schedule_revision": binding["scheduleRevision"]}


async def _prepare_managed_scheduled_analysis(
    payload: dict, settings, redis, runtime, convex, controls,
) -> dict | None:
    binding = {
        "assignmentId": payload.get("program_assignment_id"),
        "programVersionId": payload.get("program_version_id"),
        "marketId": payload.get("market"),
        "scheduleRevision": payload.get("schedule_revision"),
        "controllerRef": payload.get("controllerRef"),
    }
    if (not binding["assignmentId"] or not binding["programVersionId"]
            or not isinstance(binding["scheduleRevision"], int) or not binding["controllerRef"]):
        return None
    context = await convex.command("getAgentScheduleProfile", **binding)
    if not context:
        return None
    if not payload.get("safety_observed_at"):
        raise RuntimeError("Scheduled analysis requires a frozen observation time")
    observed_at = frozen_time(payload["safety_observed_at"])
    schedule_time_ms = int(observed_at.timestamp() * 1000)
    account_id = context["strategy"]["_id"]
    profile = context["profile"]
    model_config = context["modelConfiguration"]
    controller_mode = payload.get("controller_mode", "shadow")
    if (controller_mode not in {"shadow", "autopilot"}
            or controls.manual_guard
            or profile.get("authorityMode") != controller_mode):
        return None
    if controls.lite_mode and (
        context.get("markets", [None])[0] != payload["market"]
        or not isinstance(payload.get("cadence_minutes"), int)
        or payload["cadence_minutes"] < 15
    ):
        return None

    if controller_mode == "autopilot" and context.get("managedVaultAuthorityRefresh"):
        if not await refresh_managed_vault_authority(settings,
                context["managedVaultAuthorityRefresh"],
                strategy_account_id=account_id,
                program_version_id=binding["programVersionId"]):
            return None

    lifecycle = EvidenceLifecycleRepository(AnalysisRepository(settings.postgres_dsn).engine)
    subject = (f"schedule:{binding['assignmentId']}:{binding['programVersionId']}"
        f":{payload['market']}:{schedule_time_ms}")
    admission, _, receipts, retention = evaluate_persistence(
        producer="analysis_admission", purpose="agent_analysis", sink="temporal.analysis_payload",
        scope=LifecycleScope(kind="account", key=f"account:{account_id}",
            strategy_account_id=account_id),
        payload=managed_admission_payload(binding, account_id),
        artifact_id=subject,
        idempotency_key=f"admission:{subject}", observed_at=observed_at)
    await lifecycle.save_decision_bundle(admission, receipts, retention)
    if admission.outcome not in {"allow", "transformed"}:
        return None

    safety = await assess_analysis(settings, redis, convex, context, payload["market"],
        subject, f"safety:admit:{subject}", observed_at, True, controls.manual_guard,
        bool(model_config or settings.provider_mode), admission.decision_hash)
    if not safety.permits(observed_at):
        return None

    result = await convex.command("enqueueScheduledAnalysis",
        assignmentId=binding["assignmentId"], programVersionId=binding["programVersionId"],
        marketId=binding["marketId"], scheduleRevision=binding["scheduleRevision"],
        controllerRef=binding["controllerRef"], scheduledAtMs=schedule_time_ms,
        trigger="cadence:temporal")
    job = result.get("job")
    resumable_duplicate = (result.get("reason") == "duplicate_schedule" and job
        and job.get("status") == "queued")
    if not result.get("created") and not resumable_duplicate:
        return None
    holder = f"schedule-{job['_id']}"
    if not (await convex.claim_job(job["_id"], holder)).get("claimed"):
        return None
    try:
        assignment, version, controller, mode = require_managed_program_runtime(job, context)
        if (controller.model_dump() != binding["controllerRef"]
                or assignment.assignmentId != binding["assignmentId"]
                or version.model_dump().get("contentHash") != binding["controllerRef"].get("contentHash")
                or mode != controller_mode):
            raise ValueError("Managed schedule controller changed before job admission")
    except ValueError as exc:
        await convex.fail(job["_id"], holder, str(exc), retryable=False)
        return None

    if controls.lite_mode:
        try:
            await runtime.reserve_lite_run(job.get("strategyAccountId"))
        except RuntimeError as exc:
            await convex.fail(job["_id"], holder, str(exc), retryable=False)
            return None
    routing = ModelRouting.model_validate(model_config["routes"])
    role_config = context["managedProgram"]["teamConfig"]["roles"]
    assignments = assignments_for_configuration(job["tier"], role_config)
    estimate = route_estimate(job["tier"], assignments, routing)
    reservation = await convex.command("reserveAgentCredits", userId=job["userId"],
        jobId=job["_id"], amount=estimate["credits"],
        expiresAt=job["createdAt"] + 900_000, rateCardVersion=2)
    if reservation.get("insufficient"):
        await convex.fail(job["_id"], holder, "Insufficient credits", retryable=False)
        return None
    job_wire = {"job_id": job["_id"], "holder_id": holder, "scope": job["scope"],
        "tier": job["tier"], "strategy_account_id": job["strategyAccountId"],
        "controller_ref": controller.model_dump(), "controller_mode": mode,
        "program_assignment_id": binding["assignmentId"],
        "program_version_id": binding["programVersionId"]}
    return {"analysis": {"market": job["marketId"], "tier": job["tier"],
        "scope": job["scope"], "account_id": job["strategyAccountId"], "evidence": "",
        "freshness_ms": 0, "automatic": True, "job_id": job["_id"],
        "controller_ref": controller.model_dump(), "controller_mode": mode,
        "program_assignment_id": binding["assignmentId"],
        "program_version_id": binding["programVersionId"],
        "role_configuration": role_config, "safety_observed_at": observed_at.isoformat(),
        "schedule_revision": binding["scheduleRevision"],
        "model_configuration_version": version.version, "lite_mode": controls.lite_mode,
        "task_queue": payload["task_queue"]}, "job": job_wire}


@activity.defn
async def prepare_scheduled_analysis_activity(payload: dict) -> dict | None:
    settings = get_settings()
    from redis.asyncio import Redis
    redis = Redis.from_url(settings.redis_url)
    runtime = RuntimeControlStore(redis, settings)
    convex = ConvexWorkerClient(settings)
    try:
        controls = await runtime.get()
        if payload.get("managed_program"):
            return await _prepare_managed_scheduled_analysis(payload, settings, redis,
                runtime, convex, controls)
        profile_data = await convex.command(
            "getAgentScheduleProfile", profileId=payload["profile_id"])
        if not profile_data:
            return None
        deployments = [item for item in profile_data.get("deployments", [])
            if item["marketId"] == payload["market"] and item["status"] == "active"]
        if len(deployments) != 1:
            return None
        deployment = deployments[0]
        profile = profile_data["profile"]
        model_config = await convex.command("getModelRunConfiguration",
            strategyAccountId=profile_data["profile"]["strategyAccountId"],
            teamVersionId=deployment["teamVersionId"])
        if not payload.get("safety_observed_at"):
            raise RuntimeError("Scheduled analysis requires a frozen observation time")
        observed_at = frozen_time(payload["safety_observed_at"])
        account_id = profile_data["profile"]["strategyAccountId"]
        lifecycle = EvidenceLifecycleRepository(AnalysisRepository(settings.postgres_dsn).engine)
        admission, _, receipts, schedule = evaluate_persistence(
            producer="analysis_admission", purpose="agent_analysis",
            sink="temporal.analysis_payload",
            scope=LifecycleScope(kind="account", key=f"account:{account_id}",
                strategy_account_id=account_id),
            payload={"account_id": account_id, "market": payload["market"],
                "profile_id": payload["profile_id"],
                "schedule_revision": int(payload["schedule_revision"])},
            artifact_id=f"schedule:{payload['profile_id']}:{payload['schedule_revision']}",
            idempotency_key=
                f"admission:{payload['profile_id']}:{payload['market']}:{payload['schedule_revision']}",
            observed_at=observed_at)
        await lifecycle.save_decision_bundle(admission, receipts, schedule)
        if admission.outcome not in {"allow", "transformed"}:
            return None
        safety = await assess_analysis(settings, redis, convex, profile_data,
            payload["market"],
            f"schedule:{payload['profile_id']}:{payload['market']}:{payload['schedule_revision']}",
            f"safety:admit:{payload['profile_id']}:{payload['market']}:{payload['schedule_revision']}",
            observed_at, True, controls.manual_guard,
            bool(model_config or settings.provider_mode), admission.decision_hash)
        if controls.manual_guard or not safety.permits(observed_at):
            return None
        if controls.lite_mode and profile_data.get("markets", [None])[0] != payload["market"]:
            return None
        selected = {
            "strategyAccountId": profile["strategyAccountId"], "teamId": profile["_id"],
            "teamVersionId": deployment["teamVersionId"], "deploymentId": deployment["_id"],
            "controllerRef": deployment.get("controllerRef"),
        }
        controller = require_customer_binding(selected, deployment.get("controllerRef"),
            team_id=profile["_id"])
        if payload.get("controllerRef") is not None and payload["controllerRef"] != controller.model_dump():
            raise RuntimeError("Scheduled controller changed; synchronize schedules")
        mode = deployment["mode"]
        customer_mode(mode)
        result = await convex.command("enqueueScheduledAnalysis",
            profileId=payload["profile_id"], marketId=payload["market"],
            scheduleRevision=payload["schedule_revision"], trigger="cadence:temporal")
        if not result.get("created"):
            return None
        job = result["job"]
        holder = f"schedule-{job['_id']}"
        if not (await convex.claim_job(job["_id"], holder)).get("claimed"):
            return None
        try:
            job_controller = require_customer_binding(job, controller.model_dump(),
                team_id=profile["_id"], allow_legacy=True)
            if job_controller != controller or require_customer_mode(job, mode,
                    allow_legacy=True) != mode:
                raise ValueError("Scheduled controller changed before job admission")
        except ValueError as exc:
            await convex.fail(job["_id"], holder, str(exc), retryable=False)
            return None
        if controls.lite_mode:
            await runtime.reserve_lite_run(job.get("strategyAccountId"))
        routing = ModelRouting.model_validate(model_config["routes"]) if model_config else None
        role_config = (model_config or {}).get("teamConfig", {}).get("roles")
        assignments = (assignments_for_configuration(job["tier"], role_config)
            if role_config else assignments_for_tier(job["tier"]))
        estimate = route_estimate(job["tier"], assignments, routing)
        reservation = await convex.command("reserveAgentCredits", userId=job["userId"],
            jobId=job["_id"], amount=estimate["credits"],
            expiresAt=job["createdAt"] + 900_000,
            rateCardVersion=2 if model_config else 1)
        if reservation.get("insufficient"):
            await convex.fail(job["_id"], holder, "Insufficient credits", retryable=False)
            return None
        return {"analysis": {"market": job["marketId"], "tier": job["tier"],
            "scope": job["scope"], "account_id": job["strategyAccountId"], "evidence": "",
            "freshness_ms": 0, "automatic": True, "job_id": job["_id"],
            "profile_id": payload["profile_id"],
            "controller_ref": controller.model_dump(), "controller_mode": mode,
            "team_id": job.get("teamId"),
            "team_version_id": job.get("teamVersionId"),
            "deployment_id": job.get("deploymentId"),
            "role_configuration": (model_config or {}).get("teamConfig", {}).get("roles"),
            "safety_observed_at": observed_at.isoformat(),
            "schedule_revision": payload["schedule_revision"],
            "model_configuration_version": model_config.get("version") if model_config else None,
            "lite_mode": controls.lite_mode, "task_queue": payload["task_queue"]},
            "job": {"job_id": job["_id"], "holder_id": holder, "scope": job["scope"],
                "tier": job["tier"], "strategy_account_id": job["strategyAccountId"],
                "controller_ref": controller.model_dump(), "controller_mode": mode,
                "team_id": job.get("teamId"), "team_version_id": job.get("teamVersionId"),
                "deployment_id": job.get("deploymentId")}}
    finally:
        await redis.aclose()
