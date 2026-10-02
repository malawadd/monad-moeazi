import asyncio
import json
import socket
from uuid import uuid4

from temporalio.client import Client

from .config import get_settings
from .convex import ConvexWorkerClient
from .credits import estimated_credits
from .costs import tier_estimate
from .temporal_app import MarketAnalysisWorkflow
from .policy_draft import draft_from_text, policy_json


async def result_with_heartbeats(
    handle, convex: ConvexWorkerClient, job_id: str, holder: str, interval_seconds: float = 30,
):
    """Wait for a durable workflow while keeping exclusive ownership in Convex."""
    result_task = asyncio.create_task(handle.result())
    try:
        while True:
            done, _ = await asyncio.wait({result_task}, timeout=interval_seconds)
            if result_task in done:
                return result_task.result()
            await convex.heartbeat(job_id, holder)
    finally:
        if not result_task.done():
            result_task.cancel()


async def dispatch_forever() -> None:
    settings = get_settings()
    convex = ConvexWorkerClient(settings)
    temporal = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
    holder = f"{socket.gethostname()}-{uuid4().hex[:8]}"
    while True:
        job = await convex.claim(holder)
        if not job:
            await asyncio.sleep(1)
            continue
        job_id = job["_id"]
        try:
            trigger = job.get("trigger", "")
            automatic = trigger == "viewer_demand" or trigger.startswith("cadence:")
            if automatic and (trigger == "viewer_demand" or not settings.scheduled_analysis_enabled):
                await convex.fail(job_id, holder, "Automatic analysis is disabled", retryable=False)
                continue
            if trigger in {"manual_public", "manual_private"}:
                confirmation = json.loads(job.get("payloadJson") or "{}")
                estimate = tier_estimate(job["tier"])
                valid_cost = (
                    settings.provider_mode == "deepseek_only"
                    and confirmation.get("pricingVersion") == estimate["pricingVersion"]
                    and confirmation.get("estimatedCostMicrousd") == estimate["estimatedCostMicrousd"]
                )
                if not valid_cost:
                    await convex.fail(job_id, holder, "Current rate card was not confirmed", retryable=False)
                    continue
            if job.get("trigger") == "policy_draft":
                source = json.loads(job.get("payloadJson") or "{}").get("sourceText", "")
                policy, diff = draft_from_text(source)
                await convex.command(
                    "recordPolicyDraft", jobId=job_id, policyJson=policy_json(policy),
                    diffJson=json.dumps(diff, separators=(",", ":")),
                )
                continue
            if job.get("scope") == "private":
                reserved = await convex.command(
                    "reserveAgentCredits", userId=job["userId"], jobId=job_id,
                    amount=estimated_credits(job["tier"]), expiresAt=job["createdAt"] + 900_000,
                    rateCardVersion=1,
                )
                if reserved.get("insufficient"):
                    raise RuntimeError("Insufficient credits")
            handle = await temporal.start_workflow(
                MarketAnalysisWorkflow.run,
                {
                    "market": job["marketId"], "tier": job["tier"],
                    "scope": job["scope"], "account_id": job.get("strategyAccountId"),
                    "evidence": job.get("payloadJson", ""), "freshness_ms": 0,
                },
                id=f"analysis-{job_id}", task_queue=settings.temporal_task_queue,
            )
            result = await result_with_heartbeats(handle, convex, job_id, holder)
            await convex.complete(job_id, holder, result["synthesis"], result["calls"])
            if job.get("scope") == "private":
                specialists = sum(call["status"] == "completed" and call.get("kind") != "synthesis" for call in result["calls"])
                syntheses = sum(call["status"] == "completed" and call.get("kind") == "synthesis" for call in result["calls"])
                await convex.command(
                    "settleAgentCredits", jobId=job_id, billableAmount=specialists * 3 + syntheses * 7,
                    rateCardVersion=1, metadataJson='{"billing":"validated outputs only"}',
                )
        except Exception as exc:
            if job.get("scope") == "private":
                await convex.command("releaseAgentCredits", jobId=job_id, reason=str(exc), rateCardVersion=1)
            await convex.fail(job_id, holder, str(exc), retryable=True)


if __name__ == "__main__":
    asyncio.run(dispatch_forever())
