from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException

from pydantic import BaseModel
from redis.asyncio import Redis

from .config import get_settings
from .contracts import ExecutionDecision, TradeProposal
from .execution import ExecutionGateway
from .credentials import LocalMasterKeyWrapper
from .policy import AutomationPolicy, RiskContext
from .convex import ConvexWorkerClient
from .dependency_safety_boundaries import gateway_local_observations
from .dependency_safety_contracts import (
    SafetyEnvelopeDecision, SafetyOperation, SafetyScope, safety_request_hash,
)
from .dependency_safety_matrix import verify_safety_decision
from .dependency_safety_service import DependencyObservation, DependencySafetyService
from .dependency_safety_storage import DependencySafetyRepository
from .storage import AnalysisRepository
from .hyperliquid_credentials_api import router as hyperliquid_credentials_router
from .finance_repository import FinanceRepository
from .finance_contracts import FinanceScope
from .native_dispatch import dispatch_hyperliquid_native
from .uniswap_finance_context import verify_current_managed_uniswap_marker
from .uniswap_exit_finance_context import verify_stopped_managed_uniswap_exit
from .managed_uniswap_exit_marker import verify_stopped_uniswap_exit_submission


settings = get_settings()
master_key = settings.master_key.get_secret_value()
gateway = ExecutionGateway(
    settings,
    LocalMasterKeyWrapper(master_key) if master_key else None,
)
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = Redis.from_url(settings.redis_url)
    try:
        yield
    finally:
        await app.state.redis.aclose()


app = FastAPI(title="Moeazi Execution Gateway", version="0.1.0", lifespan=lifespan)
app.include_router(hyperliquid_credentials_router)
safety_repository = AnalysisRepository(settings.postgres_dsn)
finance_repository = FinanceRepository(settings.postgres_dsn)
safety_service = DependencySafetyService(
    settings, DependencySafetyRepository(safety_repository.engine),
)
convex_client = ConvexWorkerClient(settings)


class PreflightRequest(BaseModel):
    venue: str
    proposal: TradeProposal
    policy: AutomationPolicy
    context: RiskContext
    quote_request: dict
    idempotency_key: str
    safety_scope: SafetyScope
    safety_subject_key: str
    safety_observations: dict[str, DependencyObservation]
    safety_evaluated_at: datetime
    safety_bindings: dict[str, str]
    admission_decision: SafetyEnvelopeDecision | None = None


class QuoteRequest(BaseModel):
    venue: str
    request: dict


class DispatchRequest(BaseModel):
    venue: str
    request: dict
    decision: dict
    idempotency_key: str
    wrapped_credential: str | None = None
    account_context: str | None = None
    venue_account_id: str | None = None
    target_address: str | None = None
    native_order: dict | None = None
    finance_intent_id: str | None = None
    finance_client_id: str | None = None
    finance_payload_hash: str | None = None
    safety_subject_key: str
    safety_decision: SafetyEnvelopeDecision


class VenueMutationRequest(BaseModel):
    venue: str
    request: dict
    idempotency_key: str
    wrapped_credential: str
    account_context: str


class ReconcileRequest(BaseModel):
    venue: str
    account: str
    idempotency_key: str
    safety_subject_key: str
    safety_decision: SafetyEnvelopeDecision


class ReconcileSafetyRequest(BaseModel):
    venue: str
    account: str
    idempotency_key: str
    safety_subject_key: str
    safety_scope: SafetyScope
    safety_observations: dict[str, DependencyObservation]
    safety_evaluated_at: datetime


class UniswapFinanceVerificationRequest(BaseModel):
    strategyAccountId: str
    intentId: str
    clientId: str
    grantId: str
    assignmentId: str
    normalizedPayloadHash: str


def authorize(value: str | None) -> None:
    if value != f"Bearer {settings.worker_shared_secret.get_secret_value()}":
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.post("/internal/finance/uniswap/verify-submission")
async def verify_uniswap_submission(
    request: UniswapFinanceVerificationRequest,
    authorization: str | None = Header(default=None),
):
    """Read a previously persisted live marker; this never creates spend authority."""
    authorize(authorization)
    scope = FinanceScope(environment="live", scope_id="live",
                         strategy_account_id=request.strategyAccountId)
    try:
        marker = await finance_repository.verify_possible_submission(
            scope, intent_id=request.intentId, client_id=request.clientId,
            normalized_payload_hash=request.normalizedPayloadHash,
            venue_id="uniswap")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if marker is None:
        marker = await verify_stopped_uniswap_exit_submission(
            finance_repository, scope, intent_id=request.intentId,
            client_id=request.clientId,
            normalized_payload_hash=request.normalizedPayloadHash,
            grant_id=request.grantId, assignment_id=request.assignmentId)
        if marker is None:
            raise HTTPException(status_code=409, detail="Current native financial submission marker is unavailable")
        managed = await verify_stopped_managed_uniswap_exit(marker,
            strategy_account_id=request.strategyAccountId,
            assignment_id=request.assignmentId, grant_id=request.grantId)
    else:
        managed = await verify_current_managed_uniswap_marker(marker,
            strategy_account_id=request.strategyAccountId,
            assignment_id=request.assignmentId, grant_id=request.grantId)
    if managed is None:
        raise HTTPException(status_code=409, detail="Current managed program and owner-grant authority is unavailable")
    return {**marker, **managed}


@app.get("/health")
async def health():
    venues = {name: (await adapter.health()).model_dump() for name, adapter in gateway.adapters.items()}
    return {"status": "ok", "venues": venues}


@app.post("/internal/quote")
async def quote(request: QuoteRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    try:
        result = await gateway.quote(request.venue, request.request)
        return result.model_dump(mode="json")
    except (KeyError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/internal/preflight")
async def preflight(request: PreflightRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    admission_bindings = {
        **request.safety_bindings, "venue": request.venue.lower(),
        "account": request.proposal.account_id, "analysis_id": request.proposal.analysis_id,
        "policy_version": str(request.policy.version), "quote_reference": "pre_admission",
    }
    if request.admission_decision is None:
        raise HTTPException(status_code=409, detail="Fresh preflight admission is required")
    try:
        verify_safety_decision(
            request.admission_decision, SafetyOperation.PREFLIGHT,
            request.safety_subject_key, f"{request.idempotency_key}:admission",
            datetime.now(timezone.utc), admission_bindings,
            safety_request_hash(SafetyOperation.PREFLIGHT, {
                "proposal": request.proposal.model_dump(mode="json"),
                "policy": request.policy.model_dump(mode="json"),
                "context": request.context.model_dump(mode="json"),
                "quote_request": request.quote_request,
            }, admission_bindings),
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    decision, quote, health = await gateway.preflight(
        request.venue, request.proposal, request.policy, request.context,
        request.quote_request, request.idempotency_key,
    )
    observations = gateway_local_observations(
        request.safety_observations, request.venue, health.healthy,
        settings.live_execution_enabled, request.venue in settings.certified_venue_set,
    )
    bindings = {
        **request.safety_bindings, "venue": request.venue.lower(),
        "account": request.proposal.account_id, "analysis_id": request.proposal.analysis_id,
        "policy_version": str(request.policy.version), "quote_reference": quote.reference,
    }
    preflight_request_hash = safety_request_hash(SafetyOperation.PREFLIGHT, {
        "proposal": request.proposal.model_dump(mode="json"),
        "policy": request.policy.model_dump(mode="json"),
        "context": request.context.model_dump(mode="json"),
        "quote_request": request.quote_request, "quote": quote.model_dump(mode="json"),
    }, bindings)
    submit_request_hash = safety_request_hash(SafetyOperation.SUBMIT, {
        "proposal": request.proposal.model_dump(mode="json"),
    }, bindings)
    redis = Redis.from_url(settings.redis_url)
    try:
        preflight_safety = await safety_service.assess(
            SafetyOperation.PREFLIGHT, request.safety_scope, request.safety_subject_key,
            observations, bindings, f"{request.idempotency_key}:preflight",
            request.safety_evaluated_at, convex_client, redis,
            request_hash=preflight_request_hash,
        )
        submit_safety = await safety_service.assess(
            SafetyOperation.SUBMIT, request.safety_scope, request.safety_subject_key,
            observations, bindings, request.idempotency_key,
            request.safety_evaluated_at, convex_client, redis,
            request_hash=submit_request_hash,
        )
    finally:
        await redis.aclose()
    if not preflight_safety.permits(request.safety_evaluated_at):
        decision = decision.model_copy(update={"result": "fail"})
    decision = decision.model_copy(update={"safety_decision_hash": submit_safety.decision_hash})
    return {
        "decision": decision.model_dump(mode="json"), "quote": quote.model_dump(mode="json"),
        "preflightSafetyDecision": preflight_safety.model_dump(mode="json"),
        "safetyDecision": submit_safety.model_dump(mode="json"),
    }


@app.post("/internal/preflight/admission")
async def preflight_admission(
    request: PreflightRequest, authorization: str | None = Header(default=None),
):
    authorize(authorization)
    observations = gateway_local_observations(
        request.safety_observations, request.venue, request.venue in gateway.adapters,
        settings.live_execution_enabled, request.venue in settings.certified_venue_set,
    )
    bindings = {
        **request.safety_bindings, "venue": request.venue.lower(),
        "account": request.proposal.account_id, "analysis_id": request.proposal.analysis_id,
        "policy_version": str(request.policy.version),
        "quote_reference": "pre_admission",
    }
    redis = Redis.from_url(settings.redis_url)
    try:
        decision = await safety_service.assess(
            SafetyOperation.PREFLIGHT, request.safety_scope, request.safety_subject_key,
            observations, bindings, f"{request.idempotency_key}:admission",
            datetime.now(timezone.utc), convex_client, redis,
            request_hash=safety_request_hash(SafetyOperation.PREFLIGHT, {
                "proposal": request.proposal.model_dump(mode="json"),
                "policy": request.policy.model_dump(mode="json"),
                "context": request.context.model_dump(mode="json"),
                "quote_request": request.quote_request,
            }, bindings),
        )
    finally:
        await redis.aclose()
    if not decision.permits(datetime.now(timezone.utc)):
        raise HTTPException(status_code=409, detail="Dependency safety blocks preflight admission")
    return {"preflightAdmissionDecision": decision.model_dump(mode="json")}


@app.post("/internal/dispatch")
async def dispatch(request: DispatchRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    decision = ExecutionDecision.model_validate(request.decision)
    try:
        actual_bindings = {
            "market": str(request.request.get("market", "")).upper(),
            "venue": request.venue.lower(),
            "account": str(request.request.get("account_id", "")),
            "analysis_id": str(request.request.get("analysis_id", "")),
            "policy_version": str(decision.policy_version),
            "quote_reference": decision.quote_reference,
        }
        verify_safety_decision(
            request.safety_decision, SafetyOperation.SUBMIT, request.safety_subject_key,
            request.idempotency_key, datetime.now(timezone.utc),
            actual_bindings,
            safety_request_hash(SafetyOperation.SUBMIT, {"proposal": request.request}, actual_bindings),
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if decision.safety_decision_hash != request.safety_decision.decision_hash:
        raise HTTPException(status_code=409, detail="Policy and dependency-safety decisions are not bound")
    if settings.live_execution_enabled and request.venue in settings.certified_venue_set:
        if request.venue != "hyperliquid" or request.wrapped_credential or request.account_context \
                or not all((request.venue_account_id, request.target_address,
                            request.native_order, request.finance_intent_id,
                            request.finance_client_id, request.finance_payload_hash)):
            raise HTTPException(status_code=409, detail="Native execution authority is incomplete")
        try:
            return await dispatch_hyperliquid_native(
                proposal=TradeProposal.model_validate(request.request),
                decision=decision, idempotency_key=request.idempotency_key,
                venue_account_id=request.venue_account_id,
                target_address=request.target_address,
                native_order=request.native_order,
                intent_id=request.finance_intent_id,
                client_id=request.finance_client_id,
                payload_hash=request.finance_payload_hash,
                finance=finance_repository, gateway=gateway, settings=settings,
            )
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    return await gateway.execute_or_simulate(
        request.venue, request.request, decision, request.idempotency_key,
        request.wrapped_credential, request.account_context,
    )


@app.post("/internal/cancel")
async def cancel(request: VenueMutationRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    return await gateway.credential_mutation(
        "cancel", request.venue, request.request,
        request.wrapped_credential, request.account_context,
    )


@app.post("/internal/close")
async def close(request: VenueMutationRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    return await gateway.credential_mutation(
        "close", request.venue, request.request,
        request.wrapped_credential, request.account_context,
    )


@app.post("/internal/reconcile")
async def reconcile(request: ReconcileRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    if request.venue not in gateway.adapters:
        raise HTTPException(status_code=404, detail="Venue not found")
    try:
        verify_safety_decision(
            request.safety_decision, SafetyOperation.RECONCILE, request.safety_subject_key,
            request.idempotency_key, datetime.now(timezone.utc),
            {"venue": request.venue.lower(), "account": request.account},
            safety_request_hash(SafetyOperation.RECONCILE, {
                "venue": request.venue.lower(), "account": request.account,
            }, {"venue": request.venue.lower(), "account": request.account}),
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return await gateway.adapters[request.venue].reconcile(request.account)


@app.post("/internal/reconcile/preflight")
async def reconcile_preflight(
    request: ReconcileSafetyRequest,
    authorization: str | None = Header(default=None),
):
    authorize(authorization)
    if request.venue not in gateway.adapters:
        raise HTTPException(status_code=404, detail="Venue not found")
    health = await gateway.adapters[request.venue].health()
    observations = gateway_local_observations(
        request.safety_observations, request.venue, health.healthy,
        settings.live_execution_enabled, request.venue in settings.certified_venue_set,
    )
    redis = Redis.from_url(settings.redis_url)
    try:
        decision = await safety_service.assess(
            SafetyOperation.RECONCILE, request.safety_scope, request.safety_subject_key,
            observations, {"venue": request.venue.lower(), "account": request.account},
            request.idempotency_key, request.safety_evaluated_at,
            convex_client, redis,
            request_hash=safety_request_hash(SafetyOperation.RECONCILE, {
                "venue": request.venue.lower(), "account": request.account,
            }, {"venue": request.venue.lower(), "account": request.account}),
        )
    finally:
        await redis.aclose()
    return {"safetyDecision": decision.model_dump(mode="json")}
