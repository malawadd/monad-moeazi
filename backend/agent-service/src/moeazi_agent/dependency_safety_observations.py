from __future__ import annotations

from datetime import datetime

from .dependency_safety_contracts import DependencyStatus
from .dependency_safety_service import DependencyObservation


def _decision_time(value: object, fallback: datetime) -> datetime:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return fallback


def observed(
    healthy: bool,
    healthy_reason: str,
    unhealthy_reason: str,
    source_revision: str,
    adapter_version: str,
    evidence_reference: str | None = None,
) -> DependencyObservation:
    return DependencyObservation(
        status=DependencyStatus.HEALTHY if healthy else DependencyStatus.OPEN,
        reason_code=healthy_reason if healthy else unhealthy_reason,
        source_revision=source_revision,
        adapter_version=adapter_version,
        evidence_reference=evidence_reference,
    )


def analysis_observations(
    profile_data: dict,
    manual_guard_blocks: bool,
    redis_healthy: bool,
    route_available: bool,
    lifecycle_revision: str = "missing",
) -> dict[str, DependencyObservation]:
    strategy = profile_data.get("strategy") or {}
    profile = profile_data.get("profile") or {}
    strategy_ready = (
        strategy.get("status") == "active"
        and not strategy.get("emergencyStop", False)
        and not profile.get("paused", False)
        and profile.get("lifecycleStatus") == "active"
    )
    revision = str(profile.get("version", "unknown"))
    return {
        "convex_product_state": observed(True, "context_loaded", "context_unavailable", revision, "convex-v1"),
        "runtime_controls": observed(
            not manual_guard_blocks, "work_allowed", "manual_guard_active",
            str(profile.get("scheduleRevision", "none")), "runtime-controls-v1",
        ),
        "strategy_state": observed(
            strategy_ready, "strategy_active", "strategy_or_profile_blocked", revision, "convex-v1",
        ),
        "credits": observed(
            int(profile_data.get("availableCredits", 0)) > 0,
            "credits_available", "credits_exhausted", revision, "credit-ledger-v1",
        ),
        "provider_route": observed(
            route_available, "route_available", "route_unavailable", revision, "model-routing-v1",
        ),
        "timescale_history": observed(True, "repository_available", "repository_unavailable", revision, "timescale-v1"),
        "redis_coordination": observed(
            redis_healthy, "coordination_available", "coordination_unavailable", revision, "redis-v1",
        ),
        "evidence_lifecycle": observed(lifecycle_revision != "missing",
            "lifecycle_admitted", "lifecycle_missing", lifecycle_revision,
            "evidence-lifecycle-v1"),
    }


def proposal_observations(
    context: dict,
    evidence_ids: list[str],
    quorum_complete: bool,
    analysis_id: str,
    analysis_decision: dict,
    evaluated_at: datetime,
    lifecycle_revision: str = "missing",
) -> dict[str, DependencyObservation]:
    strategy = context.get("strategy") or {}
    profile = context.get("profile") or {}
    policy = context.get("policy") or {}
    revision = analysis_id
    return {
        "convex_product_state": observed(True, "context_loaded", "context_unavailable", revision, "convex-v1"),
        "strategy_state": observed(
            strategy.get("status") == "active" and not strategy.get("emergencyStop", False)
            and not profile.get("paused", False),
            "strategy_active", "strategy_or_profile_blocked", revision, "convex-v1",
        ),
        "active_policy": observed(
            bool(policy.get("version")), "policy_active", "policy_missing", str(policy.get("version", "none")),
            "automation-policy-v1",
        ),
        "credits": observed(
            int(context.get("availableCredits", 0)) > 0,
            "credits_available", "credits_exhausted", revision, "credit-ledger-v1",
        ),
        "evidence_set": observed(
            bool(evidence_ids), "evidence_bound", "evidence_missing", revision, "analysis-v1",
        ),
        "model_quorum": observed(
            quorum_complete, "quorum_validated", "quorum_incomplete", revision, "orchestrator-v1",
        ),
        "analysis_admission": DependencyObservation(
            status=(DependencyStatus.HEALTHY if analysis_decision.get("outcome") == "allow"
                    and _decision_time(analysis_decision.get("expires_at"), evaluated_at)
                    > evaluated_at else DependencyStatus.STALE),
            reason_code=("analysis_admitted" if analysis_decision.get("outcome") == "allow"
                         else "analysis_was_degraded"),
            source_revision=str(analysis_decision.get("decision_hash", "missing")),
            adapter_version="dependency-safety-v2",
            observed_at=_decision_time(analysis_decision.get("evaluated_at"), evaluated_at),
        ),
        "timescale_history": observed(True, "analysis_persisted", "analysis_not_persisted", revision, "timescale-v1"),
        "recovery_continuity": DependencyObservation(
            status=DependencyStatus.UNKNOWN,
            reason_code="recovery_continuity_not_authoritatively_proven",
            source_revision="missing", adapter_version="recovery-assurance-v1",
        ),
        "evidence_lifecycle": observed(lifecycle_revision != "missing",
            "lifecycle_bound", "lifecycle_missing", lifecycle_revision,
            "evidence-lifecycle-v1"),
    }


def execution_context_observations(context: dict) -> dict[str, DependencyObservation]:
    strategy = context.get("strategy") or {}
    policy = context.get("policy") or {}
    revision = str(context.get("proposal", {}).get("idempotencyKey", "execution"))
    return {
        "convex_product_state": observed(True, "context_loaded", "context_unavailable", revision, "convex-v1"),
        "strategy_state": observed(
            strategy.get("status") == "active" and not strategy.get("emergencyStop", False),
            "strategy_active", "strategy_blocked", revision, "convex-v1",
        ),
        "active_policy": observed(
            bool(policy.get("version")), "policy_active", "policy_missing", str(policy.get("version", "none")),
            "automation-policy-v1",
        ),
        "credits": observed(
            int(context.get("availableCredits", 0)) > 0,
            "credits_available", "credits_exhausted", revision, "credit-ledger-v1",
        ),
        "authoritative_risk": DependencyObservation(
            status=DependencyStatus.UNKNOWN, reason_code="authoritative_risk_not_implemented",
            source_revision="missing", adapter_version="dependency-safety-v1",
        ),
        "reconciliation": DependencyObservation(
            status=DependencyStatus.UNKNOWN, reason_code="authoritative_reconciliation_not_implemented",
            source_revision="missing", adapter_version="dependency-safety-v1",
        ),
        "owner_signer": DependencyObservation(
            status=DependencyStatus.UNKNOWN, reason_code="owner_signer_readiness_not_certified",
            source_revision="missing", adapter_version="dependency-safety-v1",
        ),
        "recovery_continuity": DependencyObservation(
            status=DependencyStatus.UNKNOWN,
            reason_code="recovery_continuity_not_authoritatively_proven",
            source_revision="missing", adapter_version="recovery-assurance-v1",
        ),
    }
