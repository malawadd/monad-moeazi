from datetime import datetime, timezone
import json

from redis.asyncio import Redis
from temporalio import activity

from .config import get_settings
from .contracts import MarketSynthesis
from .controller_contracts import parse_controller_ref, require_customer_binding, require_customer_mode
from .program_contracts import require_managed_program_runtime
from .convex import ConvexWorkerClient, _json, analysis_snapshot_payload
from .dependency_safety_boundaries import assess_proposal, assess_simulation, frozen_time
from .dependency_safety_contracts import SafetyEnvelopeDecision, SafetyOperation
from .execution_workflow import gateway_call
from .proposal_routing import proposal_from_synthesis
from .runtime_controls import RuntimeControlStore, RuntimeRunMetrics
from .storage import AnalysisRepository
from .tracing import TraceRepository


def _proposal_quorum_complete(result: dict, synthesis: MarketSynthesis, *, managed: bool) -> bool:
    reports = result.get("reports", [])
    if managed and result.get("lite_mode") is True:
        roles = [item.get("role") for item in reports if isinstance(item, dict)]
        return len(reports) == 2 and len(roles) == 2 \
            and all(isinstance(role, str) and role for role in roles) \
            and len(set(roles)) == 2
    return len(reports) >= {"focus": 4, "pro": 8, "max": 14}[synthesis.tier]
from .evidence_lifecycle_service import govern_projection


@activity.defn
async def complete_analysis_job_activity(payload: dict) -> dict | None:
    settings = get_settings()
    convex = ConvexWorkerClient(settings)
    job, result = payload["job"], payload["result"]
    context = None
    controller = None
    if job["scope"] == "private":
        job_ref = job.get("controller_ref")
        result_ref = result.get("controller_ref")
        if job_ref is not None and result_ref is None:
            raise RuntimeError("Analysis controller provenance changed")
        if job_ref is not None and result_ref is not None:
            if parse_controller_ref(job_ref) != parse_controller_ref(result_ref):
                raise RuntimeError("Analysis controller provenance changed")
        if result_ref is not None:
            if job.get("controller_mode") != result.get("controller_mode"):
                raise RuntimeError("Analysis controller mode changed")
        if not job.get("strategy_account_id"):
            raise RuntimeError("Private analysis account identity is unavailable")
        context = await convex.command("getAgentExecutionContext",
            strategyAccountId=job["strategy_account_id"], jobId=job["job_id"])
        if not context or not context.get("controllerRef") or not context.get("profile"):
            raise RuntimeError("Private analysis controller is unavailable")
        if context["controllerRef"].get("controllerKind") == "managed_program":
            _, _, controller, _ = require_managed_program_runtime(job, context)
        else:
            controller = require_customer_binding(job, context["controllerRef"],
                team_id=context["profile"]["_id"], allow_legacy=True)
        if result_ref is not None and parse_controller_ref(result_ref) != controller:
            raise RuntimeError("Analysis controller provenance changed")
        if controller.controllerKind == "customer_team":
            require_customer_mode(job, context["profile"]["authorityMode"], allow_legacy=True)
    convex_operations = 1
    synthesis_contract = MarketSynthesis.model_validate(result["synthesis"])
    repository = AnalysisRepository(settings.postgres_dsn)
    snapshot_payload_json = _json(analysis_snapshot_payload(result["synthesis"]))
    # lifecycle-sink:analysis-snapshot
    snapshot_lifecycle, snapshot_sanitized = await govern_projection(
        repository=repository, convex=convex, artifact_id=synthesis_contract.analysis_id,
        strategy_account_id=job.get("strategy_account_id"), purpose="product_projection",
        sink="convex.analysis_projection", observed_at=synthesis_contract.created_at,
        payload={"artifact_type": "analysis_snapshot", "content": snapshot_payload_json})
    await convex.complete(job["job_id"], job["holder_id"], result["synthesis"], result["calls"],
        snapshot_lifecycle.decision_hash, str(snapshot_sanitized["content"]))
    if result.get("analysis_safety"):
        await _record_safety_trace(
            settings, MarketSynthesis.model_validate(result["synthesis"]),
            SafetyEnvelopeDecision.model_validate(result["analysis_safety"]),
        )
    proposal_result = None
    if job["scope"] == "private":
        billable = sum(
            int(call.get("platform_credits", 0))
            for call in result["calls"] if call["status"] == "completed"
        )
        await convex.command(
            "settleAgentCredits",
            jobId=job["job_id"],
            billableAmount=billable,
            rateCardVersion=2 if result.get("model_configuration_version") else 1,
            metadataJson=json.dumps({
                "billing": "validated outputs only",
                "modelConfigurationVersion": result.get("model_configuration_version"),
                "credentialSources": sorted(set(call.get("credential_source", "platform") for call in result["calls"])),
                "providerCostMicrousd": sum(int(call.get("provider_cost_microusd", 0)) for call in result["calls"]),
            }, separators=(",", ":")),
        )
        convex_operations += 1
        convex_operations += 1
        if context:
            synthesis = MarketSynthesis.model_validate(result["synthesis"])
            proposal = proposal_from_synthesis(
                synthesis, result["reports"], job["strategy_account_id"],
                context["policy"]["policy"], context.get("managedSpotOrderCapUnits"),
            )
            if proposal:
                redis = Redis.from_url(settings.redis_url)
                try:
                    quorum_complete = _proposal_quorum_complete(result, synthesis,
                        managed=controller.controllerKind == "managed_program")
                    evaluated_at = frozen_time(result.get("safety_observed_at"))
                    proposal_safety = await assess_proposal(
                        settings, redis, convex, context, synthesis, proposal,
                        quorum_complete, SafetyOperation.PROPOSE, evaluated_at,
                        result.get("analysis_safety", {}),
                        result.get("analysis_lifecycle_decision_hash", "missing"),
                    )
                    if not proposal_safety.permits(evaluated_at):
                        await _record_safety_trace(settings, synthesis, proposal_safety)
                        return {"status": "blocked", "reason": "dependency_safety"}
                    approval_safety = None
                    if context["profile"]["authorityMode"] == "approval_required":
                        approval_safety = await assess_proposal(
                            settings, redis, convex, context, synthesis, proposal,
                            quorum_complete,
                            SafetyOperation.REQUEST_APPROVAL, evaluated_at,
                            result.get("analysis_safety", {}),
                            result.get("analysis_lifecycle_decision_hash", "missing"),
                        )
                        if not approval_safety.permits(evaluated_at):
                            await _record_safety_trace(settings, synthesis, approval_safety)
                            return {"status": "blocked", "reason": "dependency_safety"}
                finally:
                    await redis.aclose()
                await _record_safety_trace(settings, synthesis, proposal_safety)
                if approval_safety:
                    await _record_safety_trace(settings, synthesis, approval_safety)
                proposal_payload = {
                    "jobId": job["job_id"],
                    "strategyAccountId": job["strategy_account_id"],
                    "analysisId": synthesis.analysis_id,
                    "policyVersion": context["policy"]["version"],
                    "marketId": proposal.market,
                    "side": proposal.side,
                    "payloadJson": proposal.model_dump_json(),
                    "confidence": synthesis.confidence,
                    "consensus": synthesis.consensus,
                    "agreementStrength": abs(synthesis.consensus),
                    "controllerRef": controller.model_dump(),
                    "controllerMode": job["controller_mode"],
                    "idempotencyKey": f"proposal:{synthesis.analysis_id}",
                    "expiresAt": int(proposal.expires_at.timestamp() * 1000),
                    "proposalSafetyDecisionHash": proposal_safety.decision_hash,
                    "analysisSafetyDecisionHash": result["analysis_safety"]["decision_hash"],
                }
                if controller.controllerKind == "customer_team" and context.get("profile"):
                    proposal_payload["teamId"] = context["profile"]["_id"]
                if controller.controllerKind == "customer_team" and context.get("teamVersionId"):
                    proposal_payload["teamVersionId"] = context["teamVersionId"]
                if controller.controllerKind == "customer_team" and context.get("deploymentId"):
                    proposal_payload["deploymentId"] = context["deploymentId"]
                if controller.controllerKind == "managed_program":
                    proposal_payload["programAssignmentId"] = job["program_assignment_id"]
                    proposal_payload["programVersionId"] = job["program_version_id"]
                # lifecycle-sink:trade-proposal
                proposal_lifecycle, proposal_sanitized = await govern_projection(
                    repository=repository, convex=convex,
                    artifact_id=f"proposal:{synthesis.analysis_id}",
                    strategy_account_id=job.get("strategy_account_id"),
                    purpose="product_projection", sink="convex.analysis_projection",
                    observed_at=evaluated_at,
                    payload={"artifact_type": "trade_proposal",
                        "content": proposal_payload["payloadJson"]})
                proposal_payload["lifecycleDecisionHash"] = proposal_lifecycle.decision_hash
                proposal_payload["payloadJson"] = str(proposal_sanitized["content"])
                if approval_safety:
                    proposal_payload["approvalSafetyDecisionHash"] = approval_safety.decision_hash
                proposal_result = await convex.command("recordTradeProposal", **proposal_payload)
                convex_operations += 1
                await _record_proposal_trace(settings, synthesis, proposal, proposal_result)
                if proposal_result.get("status") == "simulated":
                    convex_operations += await _record_shadow_fill(
                        convex, proposal, proposal_result["proposalId"], settings,
                        frozen_time(result.get("safety_observed_at")),
                    )
    await _record_metrics(settings, result, convex_operations)
    return proposal_result


async def _record_shadow_fill(
    convex, proposal, proposal_id: str, settings, evaluated_at: datetime,
) -> int:
    try:
        quote = await gateway_call("/internal/quote", {
            "venue": proposal.candidate_venues[0],
            "request": {
                "market": proposal.market,
                "side": proposal.side,
                "size_usd": proposal.size_usd,
            },
        })
        redis = Redis.from_url(settings.redis_url)
        try:
            safety = await assess_simulation(
                settings, redis, convex, proposal, quote, evaluated_at,
            )
            if not safety.permits(evaluated_at):
                return 0
        finally:
            await redis.aclose()
        await convex.command(
            "recordShadowExecution",
            proposalId=proposal_id,
            entryPrice=float(quote["raw"]["price"]),
            sizeUsd=proposal.size_usd,
            quoteReference=quote["reference"],
            safetyDecisionHash=safety.decision_hash,
        )
        redis = Redis.from_url(settings.redis_url)
        try:
            repository = AnalysisRepository(settings.postgres_dsn)
            await TraceRepository(repository.engine, redis).append({
                "event_id": f"{proposal.analysis_id}:simulation",
                "analysis_id": proposal.analysis_id, "account_id": proposal.account_id,
                "event_type": "simulation", "status": "completed",
                "input_summary": {"venue": proposal.candidate_venues[0], "sizeUsd": proposal.size_usd},
                "output_summary": {"entryPrice": float(quote["raw"]["price"]), "quoteReference": quote["reference"]},
                "decision_summary": f"Recorded a shadow fill at {float(quote['raw']['price']):,.4f} without signing.",
            })
        finally:
            await redis.aclose()
        return 1
    except Exception as exc:
        await convex.command("transitionTradeProposal", proposalId=proposal_id, status="blocked")
        raise RuntimeError("Shadow simulation failed explicitly") from exc


async def _record_proposal_trace(settings, synthesis, proposal, result) -> None:
    redis = Redis.from_url(settings.redis_url)
    try:
        repository = AnalysisRepository(settings.postgres_dsn)
        await TraceRepository(repository.engine, redis).append({
            "event_id": f"{synthesis.analysis_id}:proposal",
            "analysis_id": synthesis.analysis_id, "account_id": proposal.account_id,
            "event_type": "proposal", "status": result.get("status", "recorded"),
            "input_summary": {
                "evidenceIds": proposal.evidence_ids, "candidateVenues": proposal.candidate_venues,
            },
            "output_summary": proposal.model_dump(mode="json"),
            "decision_summary": (
                f"Proposed a {proposal.side} position sized at ${proposal.size_usd:,.2f}; "
                f"routing state is {result.get('status', 'recorded').replace('_', ' ')}."
            ),
        })
    except Exception:
        return
    finally:
        await redis.aclose()


async def _record_safety_trace(settings, synthesis, decision) -> None:
    redis = Redis.from_url(settings.redis_url)
    try:
        repository = AnalysisRepository(settings.postgres_dsn)
        await TraceRepository(repository.engine, redis).append({
            "event_id": f"{synthesis.analysis_id}:dependency-safety:{decision.operation.value}",
            "analysis_id": synthesis.analysis_id,
            "account_id": decision.scope.strategy_account_id,
            "event_type": f"dependency_safety_{decision.operation.value}",
            "status": "completed" if decision.outcome == "allow" else "blocked",
            "input_summary": {
                "operation": decision.operation.value,
                "receiptHashes": [item[:12] for item in decision.receipt_hashes],
            },
            "output_summary": {
                "mode": decision.mode, "outcome": decision.outcome,
                "reasons": decision.reasons, "decisionHash": decision.decision_hash[:12],
            },
            "decision_summary": (
                f"Dependency safety {decision.outcome}ed {decision.operation.value} "
                f"in {decision.mode} mode."
            ),
        })
    except Exception:
        return
    finally:
        await redis.aclose()


async def _record_metrics(settings, result: dict, convex_operations: int) -> None:
    redis = Redis.from_url(settings.redis_url)
    try:
        successful = [call for call in result["calls"] if call["status"] == "completed"]
        await RuntimeControlStore(redis, settings).record_run_metrics(RuntimeRunMetrics(
            provider_calls=len(result["calls"]),
            successful_calls=len(successful),
            estimated_cost_usd=sum(
                float(call.get("estimated_cost_usd") or 0) for call in successful
            ),
            convex_operations=convex_operations,
            completed_at=datetime.now(timezone.utc).isoformat(),
        ))
    finally:
        await redis.aclose()


@activity.defn
async def fail_analysis_job_activity(payload: dict) -> None:
    settings = get_settings()
    convex = ConvexWorkerClient(settings)
    job = payload["job"]
    if job["scope"] == "private":
        await convex.command(
            "releaseAgentCredits",
            jobId=job["job_id"],
            reason=payload["error"],
            rateCardVersion=1,
        )
    await convex.fail(
        job["job_id"], job["holder_id"], payload["error"], retryable=False,
    )
