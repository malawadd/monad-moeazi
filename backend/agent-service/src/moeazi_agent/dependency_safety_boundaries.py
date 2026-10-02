from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache

from redis.asyncio import Redis

from .config import Settings
from .convex import ConvexWorkerClient
from .dependency_safety_contracts import (
    DependencyStatus,
    SafetyEnvelopeDecision,
    SafetyOperation,
    SafetyScope,
    safety_request_hash,
)
from .dependency_safety_observations import (
    analysis_observations,
    execution_context_observations,
    observed,
    proposal_observations,
)
from .dependency_safety_service import DependencyObservation, DependencySafetyService
from .dependency_safety_storage import DependencySafetyRepository
from .storage import AnalysisRepository


def frozen_time(value: str | None = None) -> datetime:
    if value:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    return datetime.now(timezone.utc)


def account_scope(
    account_id: str,
    market: str | None = None,
    venue: str | None = None,
    workflow_id: str | None = None,
) -> SafetyScope:
    if account_id == "public":
        return SafetyScope(
            kind="market" if market else "global",
            key=f"public:market:{market.upper()}" if market else "global",
            market=market.upper() if market else None,
        )
    parts = [f"account:{account_id}"]
    if venue:
        parts.append(f"venue:{venue.lower()}")
    if market:
        parts.append(f"market:{market.upper()}")
    kind = "workflow" if workflow_id else "market" if market else "venue" if venue else "account"
    key = (
        f"account:{account_id}:workflow:{workflow_id}" if workflow_id else
        f"account:{account_id}:venue:{venue.lower()}:market:{market.upper()}" if venue and market else
        f"account:{account_id}:market:{market.upper()}" if market else
        f"account:{account_id}:venue:{venue.lower()}" if venue else f"account:{account_id}"
    )
    return SafetyScope(
        kind=kind, key=key, strategy_account_id=account_id,
        venue=venue.lower() if venue and not workflow_id else None,
        market=market.upper() if market and not workflow_id else None,
        workflow_id=workflow_id,
    )


async def redis_is_healthy(redis: Redis) -> bool:
    try:
        return bool(await redis.ping())
    except Exception:
        return False


def service(settings: Settings) -> DependencySafetyService:
    repository = _repository(settings.postgres_dsn)
    return DependencySafetyService(settings, DependencySafetyRepository(repository.engine))


@lru_cache(maxsize=4)
def _repository(postgres_dsn: str) -> AnalysisRepository:
    return AnalysisRepository(postgres_dsn)


async def assess_ingest(
    settings: Settings,
    redis: Redis,
    convex: ConvexWorkerClient,
    source: str,
    market: str,
    observation_key: str,
    evaluated_at: datetime,
    source_healthy: bool,
) -> SafetyEnvelopeDecision:
    normalized = source.lower()
    scope = SafetyScope(
        kind="market", key=f"public:market:{market.upper()}",
        market=market.upper(),
    )
    return await service(settings).assess(
        SafetyOperation.INGEST, scope, f"ingest:{normalized}:{market.upper()}",
        {
            "timescale_history": observed(
                True, "repository_available", "repository_unavailable",
                observation_key, "timescale-v1",
            ),
            f"evidence_source:{normalized}": observed(
                source_healthy, "source_contract_valid", "source_operation_failed",
                observation_key, "evidence-adapter-v1",
            ),
            "evidence_lifecycle": observed(True, "lifecycle_admitted",
                "lifecycle_blocked", observation_key, "evidence-lifecycle-v1"),
        },
        {"source": normalized, "market": market.upper()},
        f"safety:ingest:{observation_key}", evaluated_at, convex, redis,
        request_hash=safety_request_hash(SafetyOperation.INGEST, {
            "source": normalized, "market": market.upper(),
            "observation_key": observation_key, "source_healthy": source_healthy,
        }, {"source": normalized, "market": market.upper()}),
    )


async def assess_analysis(
    settings: Settings,
    redis: Redis,
    convex: ConvexWorkerClient,
    profile_data: dict,
    market: str,
    subject_key: str,
    idempotency_key: str,
    evaluated_at: datetime,
    automatic: bool,
    manual_guard: bool,
    route_available: bool,
    lifecycle_revision: str = "missing",
) -> SafetyEnvelopeDecision:
    account_id = str((profile_data.get("profile") or {}).get("strategyAccountId") or
                     profile_data.get("strategyAccountId") or "public")
    scope = account_scope(account_id, market)
    return await service(settings).assess(
        SafetyOperation.ANALYZE, scope, subject_key,
        analysis_observations(
            profile_data, manual_guard_blocks=automatic and manual_guard,
            redis_healthy=await redis_is_healthy(redis), route_available=route_available,
            lifecycle_revision=lifecycle_revision,
        ),
        {"market": market.upper()}, idempotency_key, evaluated_at, convex, redis,
        request_hash=safety_request_hash(SafetyOperation.ANALYZE, {
            "account": account_id, "market": market.upper(), "subject": subject_key,
            "automatic": automatic, "manual_guard": manual_guard,
            "route_available": route_available,
        }, {"market": market.upper()}),
    )


async def assess_proposal(
    settings: Settings,
    redis: Redis,
    convex: ConvexWorkerClient,
    context: dict,
    synthesis,
    proposal,
    quorum_complete: bool,
    operation: SafetyOperation,
    evaluated_at: datetime,
    analysis_decision: dict,
    lifecycle_revision: str = "missing",
) -> SafetyEnvelopeDecision:
    scope = account_scope(proposal.account_id, proposal.market)
    subject = synthesis.analysis_id if operation is SafetyOperation.PROPOSE else f"approval:{synthesis.analysis_id}"
    bindings = {"market": proposal.market.upper(), "venue": proposal.candidate_venues[0].lower(),
                "analysis_decision_hash": str(analysis_decision.get("decision_hash", "missing")),
                "policy_version": str((context.get("policy") or {}).get("version", "missing"))}
    return await service(settings).assess(
        operation, scope, subject,
        proposal_observations(
            context, proposal.evidence_ids, quorum_complete, synthesis.analysis_id,
            analysis_decision, evaluated_at,
            lifecycle_revision,
        ),
        bindings,
        f"safety:{operation.value}:{synthesis.analysis_id}", evaluated_at,
        convex, redis, request_hash=safety_request_hash(operation, {
            "proposal": proposal.model_dump(mode="json"),
            "analysis_id": synthesis.analysis_id,
        }, bindings),
    )


async def assess_simulation(
    settings: Settings,
    redis: Redis,
    convex: ConvexWorkerClient,
    proposal,
    quote: dict,
    evaluated_at: datetime,
) -> SafetyEnvelopeDecision:
    venue = proposal.candidate_venues[0].lower()
    scope = account_scope(proposal.account_id, proposal.market, venue)
    observation = observed(
        bool(quote.get("reference")), "quote_received", "quote_unavailable",
        f"{proposal.analysis_id}:simulation", "execution-gateway-v1",
    )
    bindings = {"market": proposal.market.upper(), "venue": venue,
                "account": proposal.account_id, "analysis_id": proposal.analysis_id,
                "quote_reference": str(quote.get("reference", ""))}
    return await service(settings).assess(
        SafetyOperation.SIMULATE, scope, proposal.analysis_id,
        {"execution_gateway": observation, f"venue_adapter:{venue}": observation},
        bindings,
        f"safety:simulate:{proposal.analysis_id}", evaluated_at, convex, redis,
        request_hash=safety_request_hash(SafetyOperation.SIMULATE, {
            "proposal": proposal.model_dump(mode="json"), "quote": {
                "reference": str(quote.get("reference", "")),
                "price": float((quote.get("raw") or {}).get("price", 0)),
            },
        }, bindings),
    )


async def assess_render_previous(
    settings: Settings, redis: Redis, convex: ConvexWorkerClient, account_id: str,
    market: str, snapshot_hash: str, evaluated_at: datetime,
) -> SafetyEnvelopeDecision:
    return await service(settings).assess(
        SafetyOperation.RENDER_PREVIOUS, account_scope(account_id),
        f"snapshot:{snapshot_hash}", {},
        {"market": market.upper(), "snapshot_hash": snapshot_hash},
        f"safety:render:{snapshot_hash}", evaluated_at, convex, redis,
        request_hash=safety_request_hash(SafetyOperation.RENDER_PREVIOUS, {
            "account": account_id, "market": market.upper(), "snapshot_hash": snapshot_hash,
        }, {"market": market.upper(), "snapshot_hash": snapshot_hash}),
    )


def gateway_observations(context: dict) -> dict[str, DependencyObservation]:
    return execution_context_observations(context)


def gateway_local_observations(
    observations: dict[str, DependencyObservation],
    venue: str,
    venue_healthy: bool,
    live_enabled: bool,
    certified: bool,
) -> dict[str, DependencyObservation]:
    result = dict(observations)
    revision = venue.lower()
    result["execution_gateway"] = observed(True, "gateway_available", "gateway_unavailable", revision, "gateway-v1")
    result[f"venue_adapter:{revision}"] = observed(
        venue_healthy, "venue_read_available", "venue_read_unavailable", revision, "venue-adapter-v1",
    )
    result["live_execution"] = observed(
        live_enabled, "live_gate_enabled", "live_gate_closed", revision, "deployment-config-v1",
    )
    result[f"certification:{revision}"] = observed(
        certified, "venue_certified", "venue_not_certified", revision, "certification-config-v1",
    )
    return result
