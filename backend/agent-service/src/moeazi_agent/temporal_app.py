import asyncio
from datetime import timedelta

from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.common import RetryPolicy
from temporalio.worker import Worker
with workflow.unsafe.imports_passed_through():
    from moeazi_agent.config import get_settings
    from moeazi_agent.convex import ConvexWorkerClient
    from moeazi_agent.credits import estimated_credits
    from moeazi_agent.orchestrator import AnalysisOrchestrator, AnalysisRequest
    from moeazi_agent.contracts import MarketSynthesis, SignalReport
    from moeazi_agent.controller_contracts import require_customer_binding, require_customer_mode
    from moeazi_agent.program_contracts import require_managed_program_runtime
    from moeazi_agent.providers import DeepSeekProvider, OpenAIProvider
    from moeazi_agent.provider_factory import build_provider_bundle
    from moeazi_agent.model_routing import ModelRouting, route_estimate
    from moeazi_agent.roles import assignments_for_configuration, assignments_for_tier
    from moeazi_agent.execution_workflow import ExecutionWorkflow, execute_proposal_activity
    from moeazi_agent.dependency_safety_boundaries import assess_analysis, frozen_time
    from moeazi_agent.dependency_incident_workflow import DependencyIncidentWorkflow
    from moeazi_agent.evidence_lifecycle_workflow import EvidenceLifecycleWorkflow
    from moeazi_agent.evidence_lifecycle_workflow import EvidenceLifecycleOutboxWorkflow
    from moeazi_agent.evidence_lifecycle_workflow import expire_evidence_body_activity
    from moeazi_agent.evidence_lifecycle_workflow import execute_copy_commands_activity
    from moeazi_agent.evidence_lifecycle_workflow import fetch_lifecycle_outbox_activity
    from moeazi_agent.evidence_lifecycle_workflow import mark_lifecycle_outbox_activity
    from moeazi_agent.evidence_lifecycle_workflow import fetch_hold_expiries_activity, expire_hold_activity
    from moeazi_agent.analysis_completion import complete_analysis_job_activity, fail_analysis_job_activity
    from moeazi_agent.runtime_controls import RuntimeControlStore
    from moeazi_agent.provider_budget import reserve_provider_budget, settle_provider_budget
    from moeazi_agent.security import evidence_prompt_block
    from moeazi_agent.storage import AnalysisRepository
    from moeazi_agent.evidence_lifecycle_contracts import LifecycleScope
    from moeazi_agent.evidence_lifecycle_evaluator import evaluate_persistence
    from moeazi_agent.evidence_lifecycle_storage import EvidenceLifecycleRepository
    from moeazi_agent.analysis_provider_lifecycle import AnalysisProviderLifecycleGate
    from moeazi_agent.tracing import TraceRepository
    from moeazi_agent.scheduled_analysis import prepare_scheduled_analysis_activity
    from moeazi_agent.venue_setup_workflow import VenueSetupWorkflow
    from moeazi_agent.venue_setup_workflow import fail_venue_setup_activity, finalize_venue_setup_activity
    from moeazi_agent.mobile_withdrawal_workflow import MobileWithdrawalWorkflow
    from moeazi_agent.mobile_connector_workflow import (
        MobileConnectorWorkflow, reconcile_mobile_connector_activity, mark_mobile_connector_attention_activity,
    )
    from moeazi_agent.mobile_withdrawal_workflow import mark_mobile_withdrawal_attention_activity, reconcile_mobile_withdrawal_activity

@activity.defn
async def analyze_market_activity(payload: dict) -> dict:
    settings = get_settings()
    convex = ConvexWorkerClient(settings)
    managed_program = False
    if payload.get("scope") == "private":
        if not payload.get("account_id") or not payload.get("job_id"):
            raise RuntimeError("Private analysis requires account and job identity")
        profile_data = await convex.command("getAgentExecutionContext",
            strategyAccountId=payload["account_id"], jobId=payload["job_id"])
        if not profile_data or not profile_data.get("controllerRef") or not profile_data.get("profile"):
            raise RuntimeError("Private analysis controller is unavailable")
        if profile_data["controllerRef"].get("controllerKind") == "managed_program":
            _, _, controller, controller_mode = require_managed_program_runtime(payload, profile_data)
            release = (profile_data.get("managedProgram") or {}).get("agentRelease") or {}
            if payload.get("agent_release_version_id") and str(release.get("versionId")) != payload["agent_release_version_id"]:
                raise RuntimeError("Managed agent release changed during analysis")
            managed_program = True
            frozen_roles = (profile_data.get("managedProgram") or {}).get("teamConfig", {}).get("roles")
            if not frozen_roles or payload.get("role_configuration") != frozen_roles:
                raise RuntimeError("Managed program specialist composition changed")
        else:
            controller = require_customer_binding(payload, profile_data["controllerRef"],
                team_id=profile_data["profile"]["_id"], allow_legacy=True)
            controller_mode = require_customer_mode(payload,
                profile_data["profile"]["authorityMode"], allow_legacy=True)
        payload = {**payload, "controller_ref": controller.model_dump(),
            "controller_mode": controller_mode}
    else:
        profile_data = None
    from redis.asyncio import Redis
    redis = Redis.from_url(settings.redis_url)
    runtime = RuntimeControlStore(redis, settings)
    controls = await runtime.get()
    model_config = profile_data.get("modelConfiguration") if managed_program else None
    if not managed_program and payload.get("account_id") and payload.get("team_version_id"):
        model_config = await convex.command(
            "getModelRunConfiguration", strategyAccountId=payload["account_id"],
            teamVersionId=payload["team_version_id"],
        )
    elif not managed_program and payload.get("account_id") and payload.get("model_configuration_version"):
        model_config = await convex.command(
            "getModelRunConfiguration", strategyAccountId=payload["account_id"],
            version=payload["model_configuration_version"],
        )
    if profile_data is not None:
        pass
    elif payload.get("profile_id"):
        profile_data = await convex.command("getAgentScheduleProfile", profileId=payload["profile_id"])
    elif payload.get("account_id"):
        profile_data = await convex.command(
            "getAgentExecutionContext", strategyAccountId=payload["account_id"],
        )
    else:
        profile_data = {
            "profile": {"strategyAccountId": "public", "lifecycleStatus": "active", "version": 1},
            "strategy": {"status": "active", "emergencyStop": False}, "availableCredits": 1,
        }
    if not profile_data:
        await redis.aclose()
        raise RuntimeError("Analysis dependency context is unavailable")
    if not payload.get("safety_observed_at"):
        raise RuntimeError("Analysis requires a frozen observation time")
    safety_evaluated_at = frozen_time(payload["safety_observed_at"])
    repository = AnalysisRepository(settings.postgres_dsn)
    account_id = payload.get("account_id")
    lifecycle_scope = LifecycleScope(kind="account", key=f"account:{account_id}",
        strategy_account_id=account_id) if account_id else LifecycleScope(kind="public", key="public")
    admission, _, admission_receipts, admission_schedule = evaluate_persistence(
        producer="analysis_admission", purpose="agent_analysis", sink="temporal.analysis_payload",
        scope=lifecycle_scope, payload={"account_id": account_id or "public",
            "market": payload["market"], "profile_id": payload.get("profile_id") or "manual",
            "schedule_revision": int(payload.get("schedule_revision", 0))},
        artifact_id=f"analysis:{payload.get('job_id', payload['market'])}",
        idempotency_key=f"admission:{payload.get('job_id', payload['market'])}",
        observed_at=safety_evaluated_at)
    await EvidenceLifecycleRepository(repository.engine).save_decision_bundle(
        admission, admission_receipts, admission_schedule)
    if admission.outcome not in {"allow", "transformed"}:
        await redis.aclose()
        raise RuntimeError("Evidence lifecycle blocks analysis admission")
    safety = await assess_analysis(
        settings, redis, convex, profile_data, payload["market"],
        f"analysis:{payload.get('job_id', payload['market'])}",
        f"safety:analyze:{payload.get('job_id', payload['market'])}",
        safety_evaluated_at, bool(payload.get("automatic")),
        controls.manual_guard, bool(model_config or settings.provider_mode),
        admission.decision_hash,
    )
    if not safety.permits(safety_evaluated_at):
        await redis.aclose()
        raise RuntimeError("Dependency safety blocks analysis")
    if payload.get("automatic") and controls.manual_guard:
        await redis.aclose()
        raise RuntimeError("Manual Guard blocks automatic analysis")
    effective_settings = settings.model_copy(update={
        "provider_retries": 0 if controls.lite_mode else settings.provider_retries,
        "provider_max_concurrency": 1 if controls.lite_mode else settings.provider_max_concurrency,
        "specialist_max_output_tokens": 250 if controls.lite_mode else settings.specialist_max_output_tokens,
        "evidence_max_items": 3 if controls.lite_mode else settings.evidence_max_items,
        "evidence_max_chars_per_item": 300 if controls.lite_mode else settings.evidence_max_chars_per_item,
    })
    repository = AnalysisRepository(effective_settings.postgres_dsn)
    if payload.get("account_id") and (payload.get("model_configuration_version") or payload.get("team_version_id")):
        if not model_config:
            raise RuntimeError("The selected model configuration is unavailable")
        effective_settings = effective_settings.model_copy(update={
            "provider_retries": 0 if controls.lite_mode else model_config.get("retries", 0),
        })
    bundle = await build_provider_bundle(effective_settings, repository.engine, model_config)
    evidence = await repository.recent_evidence(
        payload["market"], effective_settings.evidence_max_items,
    )
    try:
        account_id = payload.get("account_id")
        lifecycle_repository = EvidenceLifecycleRepository(repository.engine)
        lifecycle_gate = AnalysisProviderLifecycleGate(
            repository.engine, lifecycle_scope, payload["job_id"], payload["market"],
            safety_evaluated_at)

        evidence_text = evidence_prompt_block(
            [(ref.id, content) for ref, content in evidence],
            effective_settings.evidence_max_chars_per_item,
        )
        evidence_text = await lifecycle_gate("preflight", evidence_text,
            [ref.id for ref, _ in evidence])
        provider_reserved = 0
        if model_config and account_id:
            selections = payload.get("role_configuration")
            assignments = (assignments_for_configuration(payload["tier"], selections)
                if selections else assignments_for_tier(payload["tier"]))
            estimate = route_estimate(payload["tier"], assignments, bundle.routing)
            provider_reserved = await reserve_provider_budget(
                redis, account_id, estimate["provider_cost_microusd"],
                int(model_config.get("providerDailyLimitMicrousd", 0)),
            )
        request = AnalysisRequest(**{
            **{key: value for key, value in payload.items()
               if key in AnalysisRequest.__dataclass_fields__},
            "evidence": evidence_text,
            "evidence_refs": tuple(ref for ref, _ in evidence),
            "lite_mode": controls.lite_mode,
            "model_routing": bundle.routing,
        })
        result = await AnalysisOrchestrator(
            bundle.providers, effective_settings.provider_max_concurrency,
            allow_single_provider=effective_settings.provider_mode == "deepseek_only" or controls.lite_mode,
            lifecycle_gate=lifecycle_gate,
            lifecycle_dispatch_gate=lifecycle_gate.verify_dispatch,
        ).run(request)
        archive_decision, admitted_archive, archive_receipts, archive_schedule = evaluate_persistence(
            # lifecycle-sink:analysis-history
            producer="analysis_archive", purpose="agent_analysis", sink="timescale.analysis_body",
            scope=lifecycle_scope,
            payload={"analysis_id": result.synthesis.analysis_id,
                "market": result.synthesis.market,
                "synthesis": result.synthesis.model_dump(mode="json"),
                "reports": [item.model_dump(mode="json") for item in result.reports],
                "calls": result.calls},
            artifact_id=result.synthesis.analysis_id,
            idempotency_key=f"analysis:{result.synthesis.analysis_id}",
            observed_at=safety_evaluated_at)
        await lifecycle_repository.save_decision_bundle(
            archive_decision, archive_receipts, archive_schedule)
        if archive_decision.outcome not in {"allow", "transformed"}:
            raise RuntimeError(f"Evidence lifecycle blocks analysis history: {archive_decision.reasons[0]}")
        if archive_schedule is None:
            raise RuntimeError("Evidence lifecycle analysis schedule is unavailable")
        admitted_synthesis = MarketSynthesis.model_validate(admitted_archive["synthesis"])
        admitted_reports = [SignalReport.model_validate(item)
            for item in admitted_archive["reports"]]
        admitted_calls = admitted_archive["calls"]
        await repository.save_run(
            admitted_synthesis, admitted_reports, admitted_calls,
            payload["scope"], payload.get("account_id"),
            model_configuration_version=payload.get("model_configuration_version"),
            lifecycle_decision=archive_decision,
            lifecycle_schedule=archive_schedule,
            admitted_archive=admitted_archive,
            team_id=payload.get("team_id"),
            team_version_id=payload.get("team_version_id"),
            deployment_id=payload.get("deployment_id"),
        )
        await TraceRepository(repository.engine, redis).record_analysis(
            admitted_synthesis, admitted_reports, admitted_calls,
            evidence, payload.get("account_id"),
            archive_decision.decision_hash,
            team_id=payload.get("team_id"),
            team_version_id=payload.get("team_version_id"),
            deployment_id=payload.get("deployment_id"),
        )
        if provider_reserved and payload.get("account_id"):
            actual = sum(
                int(call.get("provider_cost_microusd", 0))
                for call in result.calls if call.get("credential_source") == "byok"
                or call.get("provider") == "openrouter"
            )
            await settle_provider_budget(redis, payload["account_id"], provider_reserved, actual)
        return {
            "synthesis": admitted_synthesis.model_dump(mode="json"),
            "reports": [item.model_dump(mode="json") for item in admitted_reports],
            "calls": admitted_calls,
            "model_configuration_version": payload.get("model_configuration_version"),
            "controller_ref": payload.get("controller_ref"),
            "controller_mode": payload.get("controller_mode"),
            "lite_mode": payload.get("lite_mode") is True,
            "safety_observed_at": safety.evaluated_at.isoformat(),
            "analysis_safety": safety.model_dump(mode="json"),
            "analysis_lifecycle_decision_hash": archive_decision.decision_hash,
        }
    finally:
        await bundle.close()
        await redis.aclose()

@workflow.defn
class MarketAnalysisWorkflow:
    @workflow.run
    async def run(self, payload: dict) -> dict:
        analysis = payload.get("analysis", payload)
        job = payload.get("job")
        try:
            result = await workflow.execute_activity(
                analyze_market_activity,
                analysis,
                start_to_close_timeout=timedelta(minutes=8),
                retry_policy=RetryPolicy(
                    maximum_attempts=1 if analysis.get("lite_mode") else 3,
                ),
            )
            if job:
                proposal = await workflow.execute_activity(
                    complete_analysis_job_activity,
                    {"job": job, "result": result},
                    start_to_close_timeout=timedelta(minutes=2),
                    retry_policy=RetryPolicy(maximum_attempts=5),
                )
                if proposal and proposal.get("status") == "approved":
                    await workflow.execute_child_workflow(
                        ExecutionWorkflow.run,
                        {"proposal_id": proposal["proposalId"], "automatic": True},
                        id=f"execution-{proposal['proposalId']}",
                        task_queue=analysis.get("task_queue", "moeazi-analysis"),
                    )
            return result
        except Exception as exc:
            if job:
                await workflow.execute_activity(
                    fail_analysis_job_activity,
                    {"job": job, "error": str(exc)[:2_000]},
                    start_to_close_timeout=timedelta(minutes=1),
                    retry_policy=RetryPolicy(maximum_attempts=5),
                )
            raise


@workflow.defn
class ScheduledAnalysisWorkflow:
    @workflow.run
    async def run(self, payload: dict) -> dict:
        prepared = await workflow.execute_activity(
            prepare_scheduled_analysis_activity,
            {**payload, "safety_observed_at": workflow.now().isoformat()},
            start_to_close_timeout=timedelta(minutes=1),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
        if not prepared:
            return {"status": "skipped"}
        return await workflow.execute_child_workflow(
            MarketAnalysisWorkflow.run,
            prepared,
            id=f"analysis-{prepared['job']['job_id']}",
            task_queue=payload["task_queue"],
        )


async def run_worker() -> None:
    settings = get_settings()
    engine = AnalysisRepository.create_worker_engine(settings.postgres_dsn)
    try:
        AnalysisRepository.install_worker_engine(settings.postgres_dsn, engine)
        client = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
        worker = Worker(
            client, task_queue=settings.temporal_task_queue,
            workflows=[
                MarketAnalysisWorkflow, ScheduledAnalysisWorkflow, ExecutionWorkflow, VenueSetupWorkflow,
                DependencyIncidentWorkflow, EvidenceLifecycleWorkflow, EvidenceLifecycleOutboxWorkflow,
                MobileWithdrawalWorkflow,
                MobileConnectorWorkflow,
            ],
            activities=[
                analyze_market_activity, complete_analysis_job_activity, fail_analysis_job_activity,
                prepare_scheduled_analysis_activity, execute_proposal_activity,
                finalize_venue_setup_activity, fail_venue_setup_activity, expire_evidence_body_activity,
                execute_copy_commands_activity,
                fetch_lifecycle_outbox_activity, mark_lifecycle_outbox_activity, fetch_hold_expiries_activity, expire_hold_activity,
                reconcile_mobile_withdrawal_activity, mark_mobile_withdrawal_attention_activity,
                reconcile_mobile_connector_activity, mark_mobile_connector_attention_activity,
            ],
        )
        await worker.run()
    finally:
        AnalysisRepository.release_worker_engine(engine)
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_worker())
