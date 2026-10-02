import json
from datetime import datetime, timezone

from temporalio.client import Client
from temporalio.exceptions import WorkflowAlreadyStartedError
from redis.asyncio import Redis

from .config import Settings
from .convex import ConvexWorkerClient
from .controller_contracts import require_customer_binding, require_customer_mode
from .costs import tier_estimate
from .credits import estimated_credits
from .temporal_app import MarketAnalysisWorkflow
from .runtime_controls import RuntimeControlStore
from .model_routing import ModelRouting, route_estimate
from .roles import assignments_for_configuration, assignments_for_tier
from .program_contracts import require_managed_program_runtime


async def dispatch_analysis_job(client: Client, settings: Settings, job_id: str) -> dict:
    convex = ConvexWorkerClient(settings)
    holder = f"event-{job_id}"
    claimed = await convex.claim_job(job_id, holder)
    if not claimed.get("claimed"):
        status = claimed.get("reason", "unavailable")
        return {"accepted": status in {"claimed", "running", "completed"}, "status": status}
    job = claimed["job"]
    redis = Redis.from_url(settings.redis_url)
    runtime = RuntimeControlStore(redis, settings)
    try:
        model_config = None
        controller = None
        controller_mode = None
        role_configuration = None
        managed_program = None
        if job.get("scope") == "private":
            context = await convex.command("getAgentExecutionContext",
                strategyAccountId=job["strategyAccountId"], jobId=job_id)
            if not context or not context.get("controllerRef") or not context.get("profile"):
                raise RuntimeError("Private analysis controller is unavailable")
            raw_ref = context["controllerRef"]
            if raw_ref.get("controllerKind") == "managed_program":
                managed_program = context.get("managedProgram")
                _, _, controller, controller_mode = require_managed_program_runtime(job, context)
                release = (managed_program or {}).get("agentRelease") or {}
                if job.get("agentReleaseVersionId") and str(release.get("versionId")) != job["agentReleaseVersionId"]:
                    raise RuntimeError("Managed agent release changed after enqueue")
                model_config = context.get("modelConfiguration")
                role_configuration = (managed_program.get("teamConfig") or {}).get("roles")
                if not model_config or not role_configuration:
                    raise RuntimeError("Managed program routes or specialist composition are unavailable")
            else:
                controller = require_customer_binding(job, raw_ref,
                    team_id=context["profile"]["_id"], allow_legacy=True)
                controller_mode = require_customer_mode(job,
                    context["profile"]["authorityMode"], allow_legacy=True)
        if job.get("strategyAccountId") and not managed_program:
            model_config = await convex.command(
                "getModelRunConfiguration", strategyAccountId=job["strategyAccountId"],
                **({"teamVersionId": controller.controllerVersionId} if controller else {}),
            )
        _validate_manual_job(job, settings, model_config)
        controls = await runtime.get()
        if controls.lite_mode:
            await runtime.reserve_lite_run(job.get("strategyAccountId"))
        if job.get("scope") == "private":
            routing = ModelRouting.model_validate(model_config["routes"]) if model_config else None
            assignments = (assignments_for_configuration(job["tier"], role_configuration)
                if role_configuration else assignments_for_tier(job["tier"]))
            estimate = route_estimate(job["tier"], assignments, routing)
            reservation = await convex.command(
                "reserveAgentCredits", userId=job["userId"], jobId=job_id,
                amount=estimate["credits"], expiresAt=job["createdAt"] + 900_000,
                rateCardVersion=2 if model_config else 1,
            )
            if reservation.get("insufficient"):
                raise RuntimeError("Insufficient credits")
        try:
            handle = await client.start_workflow(
                MarketAnalysisWorkflow.run,
                {
                    "analysis": {
                        "market": job["marketId"], "tier": job["tier"], "scope": job["scope"],
                        "account_id": job.get("strategyAccountId"), "evidence": "", "freshness_ms": 0,
                        "job_id": job_id, "safety_observed_at": datetime.now(timezone.utc).isoformat(),
                        "lite_mode": controls.lite_mode,
                        "controller_ref": controller.model_dump() if controller else None,
                        "controller_mode": controller_mode,
                        "team_id": job.get("teamId"), "team_version_id": job.get("teamVersionId"),
                        "deployment_id": job.get("deploymentId"),
                        "program_assignment_id": job.get("programAssignmentId"),
                        "program_version_id": job.get("programVersionId"),
                        "agent_release_version_id": job.get("agentReleaseVersionId"),
                        "model_configuration_version": model_config.get("version") if model_config else None,
                        "role_configuration": role_configuration,
                        "task_queue": settings.temporal_task_queue,
                    },
                    "job": {
                        "job_id": job_id, "holder_id": holder, "scope": job["scope"],
                        "tier": job["tier"],
                        "strategy_account_id": job.get("strategyAccountId"),
                        "controller_ref": controller.model_dump() if controller else None,
                        "controller_mode": controller_mode,
                        "team_id": job.get("teamId"), "team_version_id": job.get("teamVersionId"),
                        "deployment_id": job.get("deploymentId"),
                        "program_assignment_id": job.get("programAssignmentId"),
                        "program_version_id": job.get("programVersionId"),
                        "agent_release_version_id": job.get("agentReleaseVersionId"),
                    },
                },
                id=f"analysis-{job_id}", task_queue=settings.temporal_task_queue,
            )
        except WorkflowAlreadyStartedError:
            return {
                "accepted": True, "status": "already_dispatched",
                "workflowId": f"analysis-{job_id}",
            }
        return {"accepted": True, "status": "dispatched", "workflowId": handle.id}
    except Exception as exc:
        try:
            if job.get("scope") == "private":
                await convex.command("releaseAgentCredits", jobId=job_id, reason=str(exc),
                    rateCardVersion=2 if model_config else 1)
        finally:
            await convex.fail(job_id, holder, str(exc), retryable=False)
        raise
    finally:
        await redis.aclose()


def _validate_manual_job(job: dict, settings: Settings, model_config: dict | None = None) -> None:
    if job.get("trigger") not in {"manual_public", "manual_private"}:
        raise RuntimeError("Only explicitly requested manual jobs can be dispatched")
    if not model_config and settings.provider_mode != "deepseek_only":
        raise RuntimeError("No active upfront rate card for the configured provider route")
    confirmation = json.loads(job.get("payloadJson") or "{}")
    estimate = tier_estimate(job["tier"]) if not model_config else {
        "pricingVersion": model_config["pricingVersion"],
        "estimatedCostMicrousd": model_config["estimatedProviderCostMicrousd"],
    }
    if (
        confirmation.get("pricingVersion") != estimate["pricingVersion"]
        or confirmation.get("estimatedCostMicrousd") != estimate["estimatedCostMicrousd"]
    ):
        raise RuntimeError("Current rate card was not confirmed")
