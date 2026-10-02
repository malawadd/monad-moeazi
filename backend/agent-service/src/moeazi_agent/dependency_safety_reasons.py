from __future__ import annotations

import re
from collections.abc import Iterable


REGISTERED_REASON_CODES = frozenset({
    "analysis_admitted", "analysis_not_persisted", "analysis_persisted",
    "analysis_was_degraded", "authoritative_reconciliation_not_implemented",
    "authoritative_risk_not_implemented", "context_loaded", "context_unavailable",
    "coordination_available", "coordination_unavailable", "credits_available",
    "credits_exhausted", "evidence_bound", "evidence_missing", "fixture_healthy",
    "fixture_status", "gateway_available", "gateway_unavailable", "global_outage", "healthy",
    "lifecycle_admitted", "lifecycle_blocked", "lifecycle_bound", "lifecycle_missing",
    "live_gate_closed", "live_gate_enabled", "manual_guard_active",
    "missing_authoritative_observation", "opened",
    "other_account_outage", "owner_signer_readiness_not_certified", "policy_active",
    "policy_missing", "quorum_incomplete", "quorum_validated", "quote_received",
    "quote_unavailable", "recovery_continuity_not_authoritatively_proven",
    "repository_available", "repository_unavailable", "route_available",
    "route_unavailable", "source_contract_valid", "source_operation_failed",
    "strategy_active", "strategy_blocked", "strategy_or_profile_blocked", "submit_lane_down",
    "synthetic_fixture", "venue_certified", "venue_not_certified",
    "venue_read_available", "venue_read_unavailable", "work_allowed",
})

_SAFE_DEPENDENCY = re.compile(
    r"^(?:[a-z][a-z0-9_]{0,79}|(?:venue_adapter|certification|evidence_source):"
    r"[a-z0-9][a-z0-9._-]{0,79})$"
)
_STATUS_CODES = frozenset({"degraded", "open", "stale", "unknown"})


def reconstruct_safety_reason_codes(
    reasons: list[str],
    required_dependencies: Iterable[str],
) -> list[dict[str, str]]:
    """Validate durable reasons and return bounded presentation-safe enums."""
    allowed = tuple(sorted(set(required_dependencies), key=lambda value: (-len(value), value)))
    if not allowed or any(not _SAFE_DEPENDENCY.fullmatch(value) for value in allowed):
        raise ValueError("Dependency safety operation requirements are invalid")

    def exact_dependency(value: str) -> str:
        matches = [dependency for dependency in allowed if value == dependency]
        if len(matches) != 1:
            raise ValueError("Dependency safety reason is not relevant to the operation")
        return matches[0]

    def qualified_dependency(value: str) -> tuple[str, str]:
        matches = [dependency for dependency in allowed
            if value.startswith(f"{dependency}:")]
        if not matches:
            raise ValueError("Dependency safety reason is not relevant to the operation")
        longest = len(matches[0])
        qualified = [dependency for dependency in matches if len(dependency) == longest]
        if len(qualified) != 1:
            raise ValueError("Dependency safety reason dependency is ambiguous")
        dependency_id = qualified[0]
        return dependency_id, value[len(dependency_id) + 1:]

    display: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for reason in reasons:
        if reason.startswith("missing:"):
            code = "dependency_missing"
            dependency_id = exact_dependency(reason.removeprefix("missing:"))
        elif reason.startswith("incident_open:") \
                and reason.endswith(":recovery_incomplete"):
            dependency_id = exact_dependency(reason.removeprefix(
                "incident_open:").removesuffix(":recovery_incomplete"))
            code = "dependency_incident_open"
        else:
            status, separator, qualified = reason.partition(":")
            if not separator or status not in _STATUS_CODES:
                raise ValueError("Dependency safety reason has an unsafe grammar")
            dependency_id, owner_reason = qualified_dependency(qualified)
            if owner_reason not in REGISTERED_REASON_CODES:
                raise ValueError("Dependency safety reason code is not registered")
            code = f"dependency_{status}"
        identity = (code, dependency_id)
        if identity not in seen:
            display.append({"code": code, "dependency_id": dependency_id})
            seen.add(identity)
    return display
