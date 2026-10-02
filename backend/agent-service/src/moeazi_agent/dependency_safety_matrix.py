from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from .dependency_safety_contracts import (
    DependencyHealthReceipt,
    DependencyStatus,
    FailureDomain,
    SafetyEnvelopeDecision,
    SafetyOperation,
    SafetyScope,
    decision_hash_body,
    digest,
    receipt_hash_body,
)
from .dependency_safety_reasons import reconstruct_safety_reason_codes


MATRIX_VERSION = "dependency-safety-v2"
DECISION_TTL_SECONDS = 60


@dataclass(frozen=True)
class DependencySpec:
    dependency_id: str
    failure_domain: FailureDomain
    ttl_seconds: int
    recovery_observations: int = 2
    recovery_interval_seconds: int = 5


SPECS = {
    "convex_product_state": DependencySpec("convex_product_state", FailureDomain.AUTHORITY, 30),
    "runtime_controls": DependencySpec("runtime_controls", FailureDomain.AUTHORITY, 30),
    "strategy_state": DependencySpec("strategy_state", FailureDomain.AUTHORITY, 30),
    "active_policy": DependencySpec("active_policy", FailureDomain.AUTHORITY, 60),
    "credits": DependencySpec("credits", FailureDomain.AUTHORITY, 30),
    "provider_route": DependencySpec("provider_route", FailureDomain.EVIDENCE, 300),
    "evidence_set": DependencySpec("evidence_set", FailureDomain.EVIDENCE, 60),
    "model_quorum": DependencySpec("model_quorum", FailureDomain.EVIDENCE, 120),
    "analysis_admission": DependencySpec("analysis_admission", FailureDomain.EVIDENCE, 120),
    "timescale_history": DependencySpec("timescale_history", FailureDomain.OBSERVABILITY, 30),
    "redis_coordination": DependencySpec("redis_coordination", FailureDomain.AUTHORITY, 30),
    "execution_gateway": DependencySpec("execution_gateway", FailureDomain.EXECUTION, 30),
    "authoritative_risk": DependencySpec("authoritative_risk", FailureDomain.AUTHORITY, 30),
    "reconciliation": DependencySpec("reconciliation", FailureDomain.EXECUTION, 30),
    "owner_signer": DependencySpec("owner_signer", FailureDomain.EXECUTION, 30),
    "live_execution": DependencySpec("live_execution", FailureDomain.EXECUTION, 300),
    "recovery_continuity": DependencySpec("recovery_continuity", FailureDomain.AUTHORITY, 300),
    "evidence_lifecycle": DependencySpec("evidence_lifecycle", FailureDomain.EVIDENCE, 300),
}


PREFIX_SPECS = {
    "venue_adapter:": DependencySpec("venue_adapter", FailureDomain.EXECUTION, 30),
    "certification:": DependencySpec("certification", FailureDomain.EXECUTION, 300),
    "evidence_source:": DependencySpec("evidence_source", FailureDomain.EVIDENCE, 60),
}


STATIC_REQUIREMENTS = {
    SafetyOperation.INGEST: ("timescale_history", "evidence_lifecycle"),
    SafetyOperation.ANALYZE: (
        "convex_product_state", "runtime_controls", "strategy_state", "credits",
        "provider_route", "timescale_history", "redis_coordination",
        "evidence_lifecycle",
    ),
    SafetyOperation.RENDER_PREVIOUS: ("convex_product_state",),
    SafetyOperation.SIMULATE: ("execution_gateway",),
    SafetyOperation.PROPOSE: (
        "convex_product_state", "strategy_state", "active_policy", "credits",
        "evidence_set", "model_quorum", "analysis_admission", "timescale_history",
        "recovery_continuity",
        "evidence_lifecycle",
    ),
    SafetyOperation.REQUEST_APPROVAL: (
        "convex_product_state", "strategy_state", "active_policy", "credits",
        "evidence_set", "model_quorum", "analysis_admission",
        "recovery_continuity",
        "evidence_lifecycle",
    ),
    SafetyOperation.PREFLIGHT: (
        "convex_product_state", "strategy_state", "active_policy", "credits",
        "execution_gateway", "authoritative_risk", "reconciliation",
        "recovery_continuity",
    ),
    SafetyOperation.SUBMIT: (
        "convex_product_state", "strategy_state", "active_policy", "credits",
        "execution_gateway", "authoritative_risk", "reconciliation", "owner_signer",
        "live_execution",
        "recovery_continuity",
    ),
    SafetyOperation.RECONCILE: ("convex_product_state", "execution_gateway"),
}

BINDING_KEYS = {
    SafetyOperation.INGEST: frozenset({"source", "market"}),
    SafetyOperation.ANALYZE: frozenset({"market"}),
    SafetyOperation.RENDER_PREVIOUS: frozenset({"market", "snapshot_hash"}),
    SafetyOperation.SIMULATE: frozenset({"market", "venue", "account", "analysis_id", "quote_reference"}),
    SafetyOperation.PROPOSE: frozenset({"market", "venue", "analysis_decision_hash", "policy_version"}),
    SafetyOperation.REQUEST_APPROVAL: frozenset({"market", "venue", "analysis_decision_hash", "policy_version"}),
    SafetyOperation.PREFLIGHT: frozenset({"market", "venue", "account", "analysis_id", "policy_version", "quote_reference"}),
    SafetyOperation.SUBMIT: frozenset({"market", "venue", "account", "analysis_id", "policy_version", "quote_reference"}),
    SafetyOperation.RECONCILE: frozenset({"venue", "account", "submission_reference"}),
}

REQUIRED_BINDINGS = {
    SafetyOperation.INGEST: frozenset({"source", "market"}),
    SafetyOperation.ANALYZE: frozenset({"market"}),
    SafetyOperation.RENDER_PREVIOUS: frozenset({"market", "snapshot_hash"}),
    SafetyOperation.SIMULATE: frozenset({"market", "venue", "account", "analysis_id", "quote_reference"}),
    SafetyOperation.PROPOSE: frozenset({"market", "analysis_decision_hash", "policy_version"}),
    SafetyOperation.REQUEST_APPROVAL: frozenset({"market", "analysis_decision_hash", "policy_version"}),
    SafetyOperation.PREFLIGHT: frozenset({"market", "venue", "account", "analysis_id", "policy_version", "quote_reference"}),
    SafetyOperation.SUBMIT: frozenset({"market", "venue", "account", "analysis_id", "policy_version", "quote_reference"}),
    SafetyOperation.RECONCILE: frozenset({"venue", "account"}),
}


def dependency_spec(dependency_id: str) -> DependencySpec:
    if dependency_id in SPECS:
        return SPECS[dependency_id]
    for prefix, spec in PREFIX_SPECS.items():
        if dependency_id.startswith(prefix) and len(dependency_id) > len(prefix):
            return spec
    raise ValueError(f"Unknown dependency ID: {dependency_id}")


def requirements_for(operation: SafetyOperation, bindings: dict[str, str]) -> tuple[str, ...]:
    unexpected = set(bindings) - BINDING_KEYS[operation]
    if unexpected:
        raise ValueError(f"Unsupported {operation.value} binding keys: {sorted(unexpected)}")
    missing = REQUIRED_BINDINGS[operation] - set(bindings)
    if missing or any(not bindings[key] for key in REQUIRED_BINDINGS[operation] if key in bindings):
        raise ValueError(f"Missing required {operation.value} bindings: {sorted(missing)}")
    required = list(STATIC_REQUIREMENTS[operation])
    venue = bindings.get("venue")
    source = bindings.get("source")
    if operation in {SafetyOperation.SIMULATE, SafetyOperation.PREFLIGHT,
                     SafetyOperation.SUBMIT, SafetyOperation.RECONCILE}:
        if not venue:
            raise ValueError(f"{operation.value} requires a venue binding")
        required.append(f"venue_adapter:{venue.lower()}")
    if operation is SafetyOperation.SUBMIT:
        required.append(f"certification:{venue.lower()}")
    if operation is SafetyOperation.INGEST:
        if not source:
            raise ValueError("ingest requires a source binding")
        required.append(f"evidence_source:{source.lower()}")
    return tuple(required)


def build_receipt(
    dependency_id: str,
    scope: SafetyScope,
    status: DependencyStatus,
    observed_at: datetime,
    reason_code: str,
    source_revision: str,
    adapter_version: str,
    observation_key: str,
    evidence_reference: str | None = None,
    supersedes_receipt_id: str | None = None,
) -> DependencyHealthReceipt:
    spec = dependency_spec(dependency_id)
    body = {
        "schema_version": 2, "dependency_id": dependency_id,
        "failure_domain": spec.failure_domain.value,
        "scope": scope.model_dump(mode="json"), "status": status.value,
        "observed_at": observed_at.isoformat(),
        "expires_at": (observed_at + timedelta(seconds=spec.ttl_seconds)).isoformat(),
        "reason_code": reason_code, "evidence_reference": evidence_reference,
        "source_revision": source_revision, "adapter_version": adapter_version,
        "observation_key": observation_key,
        "supersedes_receipt_id": supersedes_receipt_id,
    }
    canonical_hash = digest(body)
    return DependencyHealthReceipt(
        **body, receipt_id=f"dhr_{canonical_hash[:48]}", canonical_hash=canonical_hash,
    )


def evaluate_safety(
    operation: SafetyOperation,
    scope: SafetyScope,
    subject_key: str,
    receipts: list[DependencyHealthReceipt],
    bindings: dict[str, str],
    idempotency_key: str,
    evaluated_at: datetime,
    mode: str,
    latched_incidents: dict[str, list[str] | str] | None = None,
    request_hash: str = "",
) -> SafetyEnvelopeDecision:
    if not request_hash or len(request_hash) != 64:
        raise ValueError("A canonical v2 request hash is required")
    required = requirements_for(operation, bindings)
    newest: dict[tuple[str, str], DependencyHealthReceipt] = {}
    for receipt in receipts:
        if receipt.schema_version != 2:
            continue
        if not scope_applies(receipt.scope, scope):
            continue
        key = (receipt.dependency_id, receipt.scope.key)
        current = newest.get(key)
        if current is None or (receipt.observed_at, receipt.canonical_hash) > (
            current.observed_at, current.canonical_hash,
        ):
            newest[key] = receipt
    reasons: list[str] = []
    hashes: list[str] = []
    incident_keys: list[str] = []
    applied_expires: list[datetime] = []
    for dependency_id in required:
        applied = sorted(
            (item for (item_id, _), item in newest.items() if item_id == dependency_id),
            key=lambda item: (_scope_rank(item.scope.kind), item.scope.key),
        )
        if not applied:
            reasons.append(f"missing:{dependency_id}")
            incident_keys.append(incident_key(dependency_id, scope))
            continue
        for receipt in applied:
            status = receipt.status_at(evaluated_at)
            hashes.append(receipt.canonical_hash)
            applied_expires.append(receipt.expires_at)
            if status is not DependencyStatus.HEALTHY:
                reasons.append(f"{status.value}:{dependency_id}:{receipt.reason_code}")
                incident_keys.append(incident_key(dependency_id, receipt.scope))
        latch = (latched_incidents or {}).get(dependency_id, [])
        for item in ([latch] if isinstance(latch, str) else latch):
            if item not in incident_keys:
                reasons.append(f"incident_open:{dependency_id}:recovery_incomplete")
                incident_keys.append(item)
    outcome = "allow" if not reasons else "block"
    decision_expiry = max(
        evaluated_at,
        min([evaluated_at + timedelta(seconds=DECISION_TTL_SECONDS), *applied_expires]),
    )
    body = {
        "schema_version": 2, "matrix_version": MATRIX_VERSION, "mode": mode,
        "operation": operation.value, "subject_key": subject_key,
        "scope": scope.model_dump(mode="json"),
        "breaker_state": "closed" if outcome == "allow" else "open",
        "outcome": outcome, "reasons": reasons,
        "receipt_hashes": hashes, "incident_keys": incident_keys,
        "bindings": dict(sorted(bindings.items())),
        "binding_hash": digest(dict(sorted(bindings.items()))),
        "request_hash": request_hash,
        "evaluated_at": evaluated_at.isoformat(),
        "expires_at": decision_expiry.isoformat(),
        "idempotency_key": idempotency_key,
    }
    decision_hash = digest(body)
    return SafetyEnvelopeDecision(
        **body, decision_id=f"sed_{decision_hash[:48]}", decision_hash=decision_hash,
    )


def incident_key(dependency_id: str, scope: SafetyScope) -> str:
    return f"dsi_{digest({'dependency_id': dependency_id, 'scope': scope.model_dump(mode='json'), 'matrix': MATRIX_VERSION})[:40]}"


def verify_health_receipt(receipt: DependencyHealthReceipt) -> None:
    expected = digest(receipt_hash_body(receipt))
    if receipt.canonical_hash != expected or receipt.receipt_id != f"dhr_{expected[:48]}":
        raise ValueError("Dependency health receipt hash is invalid")


def verify_safety_decision(
    decision: SafetyEnvelopeDecision,
    operation: SafetyOperation,
    subject_key: str,
    idempotency_key: str,
    now: datetime,
    bindings: dict[str, str] | None = None,
    request_hash: str | None = None,
    *,
    require_permit: bool = True,
) -> list[dict[str, str]]:
    if decision.schema_version != 2 or decision.matrix_version != MATRIX_VERSION:
        raise ValueError("Legacy dependency safety decisions are not enforceable")
    expected = digest(decision_hash_body(decision))
    if expected != decision.decision_hash or decision.decision_id != f"sed_{expected[:48]}":
        raise ValueError("Dependency safety decision hash is invalid")
    canonical_bindings = dict(sorted(decision.bindings.items()))
    required_dependencies = requirements_for(decision.operation, canonical_bindings)
    if decision.binding_hash != digest(canonical_bindings):
        raise ValueError("Dependency safety binding hash is invalid")
    if decision.evaluated_at > now \
            or decision.expires_at > decision.evaluated_at + timedelta(
                seconds=DECISION_TTL_SECONDS):
        raise ValueError("Dependency safety decision time window is invalid")
    expected_breaker = "closed" if decision.outcome == "allow" else "open"
    if decision.breaker_state != expected_breaker \
            or (decision.outcome == "allow") == bool(decision.reasons):
        raise ValueError("Dependency safety outcome invariants are invalid")
    display_reasons = reconstruct_safety_reason_codes(
        decision.reasons, required_dependencies)
    if len(set(decision.receipt_hashes)) != len(decision.receipt_hashes) \
            or any(len(value) != 64 or any(character not in "0123456789abcdef"
                for character in value) for value in decision.receipt_hashes):
        raise ValueError("Dependency safety receipt hashes are invalid")
    if decision.operation is not operation or decision.subject_key != subject_key:
        raise ValueError("Dependency safety decision subject or operation does not match")
    if decision.idempotency_key != idempotency_key or decision.expires_at <= now:
        raise ValueError("Dependency safety decision is expired or has the wrong idempotency key")
    actual_bindings = dict(sorted((bindings or {}).items()))
    if decision.bindings != actual_bindings or decision.binding_hash != digest(actual_bindings):
        raise ValueError("Dependency safety bindings do not match exactly")
    if request_hash is None or decision.request_hash != request_hash:
        raise ValueError("Dependency safety request hash does not match")
    if require_permit and not decision.permits(now):
        raise ValueError("Dependency safety decision blocks this operation")
    return display_reasons


def _scope_rank(kind: str) -> int:
    return ("global", "tenant", "account", "venue", "market", "workflow").index(kind)


def scope_applies(receipt: SafetyScope, target: SafetyScope) -> bool:
    if receipt.kind == "global":
        return True
    if receipt.kind == "tenant":
        return bool(receipt.tenant_id and receipt.tenant_id == target.tenant_id)
    if receipt.kind == "account":
        return bool(receipt.strategy_account_id == target.strategy_account_id)
    if receipt.kind == "venue":
        return bool(
            receipt.strategy_account_id == target.strategy_account_id
            and receipt.venue == target.venue
            and (not receipt.market or receipt.market == target.market)
        )
    if receipt.kind == "market":
        return bool(
            receipt.strategy_account_id == target.strategy_account_id
            and receipt.market == target.market
            and (not receipt.venue or receipt.venue == target.venue)
        )
    return bool(receipt.workflow_id and receipt.workflow_id == target.workflow_id)
