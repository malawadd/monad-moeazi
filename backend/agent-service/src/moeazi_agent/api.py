from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException, Query
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from pydantic import BaseModel
from redis.asyncio import Redis
from temporalio.client import Client, WorkflowExecutionStatus

from .config import get_settings
from .contracts import ExecutionDecision, TradeProposal
from .credits import estimated_credits
from .costs import tier_estimate
from .policy import AutomationPolicy, RiskContext, evaluate_policy
from .observability import configure_observability
from .roles import assignments_for_tier
from .temporal_app import MarketAnalysisWorkflow
from .evidence_lifecycle_workflow import EvidenceLifecycleOutboxWorkflow
from .execution_workflow import ExecutionWorkflow
from .mobile_withdrawal_workflow import MobileWithdrawalWorkflow
from .mobile_connector_workflow import MobileConnectorWorkflow
from temporalio.exceptions import WorkflowAlreadyStartedError
from .data_adapters import PushEvidenceAdapter
from .job_dispatch import dispatch_analysis_job
from .runtime_controls import RuntimeControlStore, RuntimeControlUpdate
from .schedule_manager import (
    set_agent_schedules_paused, sync_managed_program_schedules, sync_profile_schedules,
)
from .convex import ConvexWorkerClient
from .storage import AnalysisRepository
from .routing_contracts import RouteRequest
from .routing_service import RoutingService
from .swap_api import router as swap_router
from .venue_setup_api import router as venue_setup_router
from .provider_api import router as provider_router
from .monitoring_api import router as monitoring_router
from .dependency_safety_boundaries import assess_ingest
from .evidence_lifecycle_service import persist_ingested_evidence, preflight_ingested_evidence
from .evaluation_api import router as evaluation_router
from .evaluation_v2_api import router as evaluation_v2_router
from .customer_research_api import router as customer_research_router
from .evaluation_assets_api import router as evaluation_assets_router
from .finance_routes import router as finance_router
from .finance_native_activation_api import router as finance_native_activation_router
from .finance_native_vault_api import router as finance_native_vault_router
from .finance_native_stop_api import router as finance_native_stop_router
from .managed_vault_stop_api import router as managed_vault_stop_router
from .managed_vault_release_api import router as managed_vault_release_router
from .managed_uniswap_buy_api import router as managed_uniswap_buy_router
from .managed_uniswap_close_api import router as managed_uniswap_close_router
from .managed_schedule_status_api import router as managed_schedule_status_router
from .managed_vault_runtime_readiness import managed_vault_runtime_readiness
from .finance_repository import FinanceRepository
from .lifecycle_repository import SimulationLifecycleRepository
from .lifecycle_simulator import simulate_order
from .simulation_routes import router as simulation_router


settings = get_settings()
configure_observability(settings.service_name, settings.otel_exporter_otlp_endpoint)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.temporal = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
    try:
        await app.state.temporal.start_workflow(EvidenceLifecycleOutboxWorkflow.run,
            id="evidence-lifecycle-outbox-v1", task_queue=settings.temporal_task_queue)
    except WorkflowAlreadyStartedError:
        pass
    app.state.repository = AnalysisRepository(settings.postgres_dsn)
    app.state.finance = FinanceRepository(settings.postgres_dsn)
    # API owns registration/controls; only the dedicated worker can review entry
    # authority and process simulation events through the financial writer.
    app.state.simulation = SimulationLifecycleRepository(app.state.finance, simulator=simulate_order)
    app.state.redis = Redis.from_url(settings.redis_url)
    app.state.runtime_controls = RuntimeControlStore(app.state.redis, settings)
    app.state.routing = RoutingService(app.state.redis, settings)
    yield
    await app.state.redis.aclose()
    await app.state.finance.engine.dispose()


app = FastAPI(title="Moeazi Agent Platform", version="0.1.0", lifespan=lifespan)
app.include_router(swap_router)
app.include_router(venue_setup_router)
app.include_router(provider_router)
app.include_router(monitoring_router)
app.include_router(evaluation_router)
app.include_router(evaluation_v2_router)
app.include_router(customer_research_router)
app.include_router(evaluation_assets_router)
app.include_router(finance_router)
app.include_router(finance_native_activation_router)
app.include_router(finance_native_vault_router)
app.include_router(finance_native_stop_router)
app.include_router(managed_vault_stop_router)
app.include_router(managed_vault_release_router)
app.include_router(managed_uniswap_buy_router)
app.include_router(managed_uniswap_close_router)
app.include_router(managed_schedule_status_router)
app.include_router(simulation_router)
FastAPIInstrumentor.instrument_app(app)


class WorkflowRequest(BaseModel):
    job_id: str
    market: str
    tier: str
    scope: str
    account_id: str | None = None
    evidence: str = ""
    confirmed: bool = False
    pricing_version: str = ""
    estimated_cost_microusd: int = 0


class DispatchJobRequest(BaseModel):
    job_id: str


class MobileWithdrawalRequest(BaseModel):
    operation_id: str


class PolicyCheckRequest(BaseModel):
    policy: AutomationPolicy
    proposal: TradeProposal
    context: RiskContext
    quote_reference: str
    idempotency_key: str


class PushEvidenceRequest(BaseModel):
    source: str
    market: str
    reference: str
    payload: str
    quality_score: float = 0.7


class ScheduleSyncRequest(BaseModel):
    profile_id: str


class ManagedScheduleSyncRequest(BaseModel):
    assignment_id: str


class ExecutionDispatchRequest(BaseModel):
    proposal_id: str
    automatic: bool = False


def authorize(value: str | None) -> None:
    if value != f"Bearer {settings.worker_shared_secret.get_secret_value()}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def require_dev_controls() -> None:
    if not settings.agent_dev_controls_enabled:
        raise HTTPException(status_code=404, detail="Not found")


@app.get("/health")
async def health():
    controls = await app.state.runtime_controls.get()
    return {
        "status": "ok", "live_execution": settings.live_execution_enabled,
        "provider_mode": settings.provider_mode,
        "degraded": settings.provider_mode != "balanced",
        "analysis_mode": "manual_guard" if controls.manual_guard else "autonomous",
        "scheduled_analysis_enabled": not controls.manual_guard,
        "thinking_enabled": settings.deepseek_thinking_enabled,
        "manual_guard": controls.manual_guard,
        "lite_mode": controls.lite_mode,
    }


@app.get("/v1/finance/managed-program/runtime-readiness")
async def managed_program_runtime_readiness(authorization: str | None = Header(default=None),
        vault_address: str = Query(default="", alias="vaultAddress")):
    authorize(authorization)
    controls = await app.state.runtime_controls.get()
    return managed_vault_runtime_readiness(settings, controls, vault_address)


@app.get("/v1/routing/markets")
async def routing_markets(authorization: str | None = Header(default=None)):
    authorize(authorization)
    markets = await app.state.routing.markets()
    return {"markets": [item.model_dump(mode="json") for item in markets]}


@app.post("/v1/routing/preview")
async def routing_preview(request: RouteRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    try:
        return await app.state.routing.preview(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/tiers/{tier}")
async def tier_contract(tier: str):
    try:
        assignments = assignments_for_tier(tier)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    estimate = tier_estimate(tier)
    return {
        "tier": tier, "calls": len(assignments), "estimatedCredits": estimated_credits(tier),
        "providerMode": settings.provider_mode, "estimate": estimate,
    }


@app.post("/internal/workflows")
async def start_workflow(request: WorkflowRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    if request.scope == "private":
        raise HTTPException(status_code=409,
            detail="Private analysis requires a bound job; use /v1/jobs/dispatch")
    if settings.provider_mode != "deepseek_only":
        raise HTTPException(status_code=409, detail="No active upfront rate card for the configured provider route")
    try:
        estimate = tier_estimate(request.tier)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if (
        not request.confirmed
        or request.pricing_version != estimate["pricingVersion"]
        or request.estimated_cost_microusd != estimate["estimatedCostMicrousd"]
    ):
        raise HTTPException(status_code=409, detail="Confirm the current tier and cost estimate before starting analysis")
    controls = await app.state.runtime_controls.get()
    handle = await app.state.temporal.start_workflow(
        MarketAnalysisWorkflow.run,
        {
            "market": request.market, "tier": request.tier, "scope": request.scope,
            "account_id": request.account_id, "evidence": request.evidence, "freshness_ms": 0,
            "job_id": request.job_id,
            "safety_observed_at": datetime.now(timezone.utc).isoformat(),
            "lite_mode": controls.lite_mode,
        },
        id=f"analysis-{request.job_id}", task_queue=settings.temporal_task_queue,
    )
    return {"workflowId": handle.id}


@app.post("/v1/jobs/dispatch")
async def dispatch_job(request: DispatchJobRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    try:
        return await dispatch_analysis_job(app.state.temporal, settings, request.job_id)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/internal/runtime-controls")
async def get_runtime_controls(authorization: str | None = Header(default=None)):
    authorize(authorization)
    require_dev_controls()
    controls = await app.state.runtime_controls.get()
    return await app.state.runtime_controls.dashboard_response(controls)


@app.patch("/internal/runtime-controls")
async def update_runtime_controls(
    request: RuntimeControlUpdate,
    authorization: str | None = Header(default=None),
):
    authorize(authorization)
    require_dev_controls()
    try:
        previous = await app.state.runtime_controls.get()
        controls = (
            await app.state.runtime_controls.reset(request.updated_by)
            if request.manual_guard is True and request.lite_mode is True
            else await app.state.runtime_controls.update(request)
        )
        if controls.manual_guard != previous.manual_guard:
            await set_agent_schedules_paused(app.state.temporal, controls.manual_guard)
            if controls.manual_guard:
                await ConvexWorkerClient(settings).command("cancelAutomaticAnalysisJobs")
        return await app.state.runtime_controls.dashboard_response(controls)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/v1/schedules/sync")
async def sync_schedules(request: ScheduleSyncRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    profile = await ConvexWorkerClient(settings).command(
        "getAgentScheduleProfile", profileId=request.profile_id,
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")
    controls = await app.state.runtime_controls.get()
    return await sync_profile_schedules(app.state.temporal, profile, controls, settings)


@app.post("/v1/schedules/managed-sync")
async def sync_managed_schedules(
    request: ManagedScheduleSyncRequest, authorization: str | None = Header(default=None),
):
    authorize(authorization)
    binding = await ConvexWorkerClient(settings).command(
        "getAgentScheduleProfile", assignmentId=request.assignment_id,
    )
    if not binding:
        raise HTTPException(status_code=404, detail="Managed assignment not found")
    controls = await app.state.runtime_controls.get()
    return await sync_managed_program_schedules(app.state.temporal, binding, controls, settings)


@app.post("/v1/executions/dispatch")
async def dispatch_execution(
    request: ExecutionDispatchRequest,
    authorization: str | None = Header(default=None),
):
    authorize(authorization)
    workflow_id = f"execution-{request.proposal_id}"
    try:
        await app.state.temporal.start_workflow(
            ExecutionWorkflow.run,
            {"proposal_id": request.proposal_id, "automatic": request.automatic},
            id=workflow_id,
            task_queue=settings.temporal_task_queue,
        )
        return {"workflowId": workflow_id, "status": "dispatched"}
    except WorkflowAlreadyStartedError:
        return {"workflowId": workflow_id, "status": "already_dispatched"}


@app.post("/v1/mobile-withdrawals/reconcile")
async def reconcile_mobile_withdrawal(
    request: MobileWithdrawalRequest,
    authorization: str | None = Header(default=None),
):
    authorize(authorization)
    workflow_id = f"mobile-withdrawal-{request.operation_id}"
    try:
        await app.state.temporal.start_workflow(
            MobileWithdrawalWorkflow.run, request.operation_id,
            id=workflow_id, task_queue=settings.temporal_task_queue,
        )
        return {"workflowId": workflow_id, "status": "dispatched"}
    except WorkflowAlreadyStartedError:
        return {"workflowId": workflow_id, "status": "already_dispatched"}


@app.post("/v1/mobile-connectors/reconcile")
async def reconcile_mobile_connector(request: MobileWithdrawalRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    workflow_id = f"mobile-connector-{request.operation_id}"
    try:
        await app.state.temporal.start_workflow(
            MobileConnectorWorkflow.run, request.operation_id,
            id=workflow_id, task_queue=settings.temporal_task_queue,
        )
        return {"workflowId": workflow_id, "status": "dispatched"}
    except WorkflowAlreadyStartedError:
        return {"workflowId": workflow_id, "status": "already_dispatched"}


@app.get("/internal/workflows/{workflow_id}")
async def workflow_status(workflow_id: str, authorization: str | None = Header(default=None)):
    authorize(authorization)
    handle = app.state.temporal.get_workflow_handle(workflow_id)
    description = await handle.describe()
    status = description.status.name.lower()
    response = {"workflowId": workflow_id, "status": status}
    if description.status == WorkflowExecutionStatus.COMPLETED:
        response["result"] = await handle.result()
    return response


@app.post("/internal/policy/check", response_model=ExecutionDecision)
async def check_policy(request: PolicyCheckRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    return evaluate_policy(request.policy, request.proposal, request.context, request.quote_reference, request.idempotency_key)


@app.post("/internal/evidence")
async def push_evidence(request: PushEvidenceRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    if request.source not in {"quicknode", "cryptopanic", "gdelt", "x_filtered_stream", "reddit"}:
        raise HTTPException(status_code=400, detail="Unsupported evidence source")
    adapter = PushEvidenceAdapter(request.source, max(0, min(1, request.quality_score)))
    item = adapter.normalize(request.payload, request.reference)
    item.metadata["market"] = request.market.upper()
    try:
        lifecycle_preflight = preflight_ingested_evidence(item, request.market)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    safety = await assess_ingest(
        settings, app.state.redis, ConvexWorkerClient(settings), request.source,
        request.market, lifecycle_preflight.decision_hash, item.ref.observed_at, True,
    )
    if not safety.permits(item.ref.observed_at):
        raise HTTPException(status_code=409, detail="Dependency safety blocks evidence ingestion")
    try:
        decision = await persist_ingested_evidence(repository=app.state.repository,
            redis=app.state.redis, temporal=app.state.temporal,
            task_queue=settings.temporal_task_queue, item=item, market=request.market)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"evidenceId": item.ref.id, "contentHash": item.ref.content_hash,
        "lifecycleDecisionHash": decision.decision_hash}
