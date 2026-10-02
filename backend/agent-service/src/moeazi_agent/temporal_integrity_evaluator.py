"""Integer-only, fixture-only temporal evaluator."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .temporal_integrity_contracts import (CausalLink, ClockDomainSpec, NonceLease,
    SequencePoint, TemporalSafetyDecision, TemporalScope, TimeHealthObservation,
    TemporalInputManifest, ValidityInterval, digest)

RISK_OPERATIONS = {"prepare", "sign", "submit", "budget_reserve"}
SAFE_OPERATIONS = {"close", "cancel", "revoke", "reconcile"}


def frozen_manifest(operation: str, scope: TemporalScope, spec: ClockDomainSpec,
                    observation: TimeHealthObservation, interval: ValidityInterval,
                    sequence: SequencePoint | None, causal: CausalLink | None,
                    nonce: NonceLease | None, key: str, registry_hash: str,
                    inventory_hash: str, scenario_hash: str) -> TemporalInputManifest:
    request_hash = digest({"operation": operation, "scope": scope, "scenarioHash": scenario_hash,
                           "idempotencyKey": key})
    body = {"operation": operation, "scope": scope, "spec": spec,
        "observation": observation, "interval": interval, "sequence": sequence, "causal": causal,
        "nonce": nonce, "registry_hash": registry_hash, "inventory_hash": inventory_hash,
        "scenario_hash": scenario_hash, "idempotency_key": key, "request_hash": request_hash}
    return TemporalInputManifest(**body, manifest_hash=digest(body))


def evaluate(operation: str, scope: TemporalScope, spec: ClockDomainSpec,
             observation: TimeHealthObservation, interval: ValidityInterval,
             sequence: SequencePoint | None, causal: CausalLink | None,
             nonce: NonceLease | None, now: datetime, key: str, registry_hash: str,
             inventory_hash: str, scenario_hash: str) -> TemporalSafetyDecision:
    reasons: list[str] = []
    if spec.spec_hash != digest(spec.model_dump(exclude={"spec_hash"})):
        reasons.append("spec_hash_mismatch")
    if operation not in spec.allowed_operations: reasons.append("operation_unsupported")
    if (observation.domain_id != spec.domain_id or interval.domain_id != spec.domain_id
            or observation.spec_hash != spec.spec_hash): reasons.append("domain_mismatch")
    if observation.scope != scope or observation.epoch != spec.epoch: reasons.append("scope_or_epoch_mismatch")
    if observation.status != "healthy": reasons.append(f"time_{observation.status}")
    if observation.uncertainty_us > spec.max_uncertainty_us: reasons.append("uncertainty_exceeded")
    max_expiry = observation.observed_at + timedelta(microseconds=spec.max_age_us)
    if observation.observed_at > now or observation.expires_at > max_expiry or observation.expires_at <= now:
        reasons.append("observation_stale")
    if not (interval.valid_from_us <= observation.earliest_us and observation.latest_us < interval.valid_until_us): reasons.append("interval_ambiguous_or_expired")
    if operation in RISK_OPERATIONS:
        if sequence is None or causal is None: reasons.append("native_causality_missing")
        if operation in {"sign", "submit"} and (nonce is None or nonce.state != "reserved"
                or nonce.operation != operation or nonce.domain_id != spec.domain_id
                or nonce.acted_for_account != scope.key): reasons.append("nonce_lease_missing")
    if causal and sequence:
        if causal.successor_hash != sequence.event_hash: reasons.append("causal_sequence_mismatch")
        expected_kind = {"chain": "chain", "venue_sequence": "venue", "workflow": "workflow"}.get(spec.domain_type)
        if expected_kind and sequence.kind != expected_kind: reasons.append("sequence_domain_mismatch")
        expected_proof = {"chain": "block_ancestor", "venue_sequence": "native_sequence",
                          "workflow": "workflow_history"}.get(spec.domain_type)
        if expected_proof and causal.proof_kind != expected_proof: reasons.append("causal_proof_mismatch")
    outcome = "allow" if not reasons else (
        "safe_only" if operation in SAFE_OPERATIONS and "operation_unsupported" not in reasons else "block")
    expiry = min(observation.expires_at, now + timedelta(microseconds=spec.decision_ttl_us))
    manifest = frozen_manifest(operation, scope, spec, observation, interval, sequence, causal,
        nonce, key, registry_hash, inventory_hash, scenario_hash)
    body = {"operation": operation, "scope": scope, "outcome": outcome, "reasons": sorted(set(reasons)),
        "observation_hash": observation.observation_hash, "interval_hash": interval.interval_hash,
        "sequence_hash": digest(sequence) if sequence else None, "causal_hash": causal.link_hash if causal else None,
        "nonce_lease_hash": nonce.lease_hash if nonce else None, "registry_hash": registry_hash,
        "inventory_hash": inventory_hash, "input_manifest_hash": manifest.manifest_hash,
        "request_hash": manifest.request_hash, "expires_at": expiry, "idempotency_key": key}
    return TemporalSafetyDecision(**body, decision_hash=digest(body))


def fixture_observation(spec: ClockDomainSpec, scope: TemporalScope, now_us: int, now: datetime, status: str = "healthy") -> TimeHealthObservation:
    body = {"domain_id": spec.domain_id, "spec_hash": spec.spec_hash, "scope": scope, "epoch": spec.epoch,
        "earliest_us": now_us, "latest_us": now_us, "source_earliest_us": now_us, "source_latest_us": now_us,
        "uncertainty_us": 0, "status": status, "observed_at": now, "expires_at": now + timedelta(microseconds=spec.max_age_us)}
    return TimeHealthObservation(**body, observation_hash=digest(body))
