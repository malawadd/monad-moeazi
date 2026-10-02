"""Pure fail-closed evaluator; persistence is deliberately supplied separately."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Iterable

from .execution_artifact_contracts import (ArtifactObservation, ArtifactScope, CertificationDecision,
    CertificationInputManifest, DriftEvent, digest)
from .execution_artifact_registry import closure, registry_hash


def make_observation(spec, boundary: str, now: datetime, manifest_hash: str, identity=None,
                     finality: str = "finalized", block_number: int = 1, block_hash: str = "fixture-block",
                     parent_hash: str = "fixture-parent") -> ArtifactObservation:
    body = {"artifact_id": spec.artifact_id, "version": spec.version, "scope": spec.scope, "source": "local_fixture",
        "boundary": boundary, "identity": identity or spec.identity, "fixture_manifest_hash": manifest_hash,
        "observed_at": now, "expires_at": min(spec.expires_at, now + timedelta(seconds=spec.freshness_seconds)),
        "finality": finality, "block_number": block_number, "block_hash": block_hash, "parent_hash": parent_hash}
    return ArtifactObservation(**body, observation_hash=digest(body))


def frozen_manifest(operation: str, account_scope: ArtifactScope, boundary: str,
                    required: Iterable, observations: Iterable[ArtifactObservation],
                    idempotency_key: str) -> CertificationInputManifest:
    """Return the strict frozen identity for exactly the inputs being evaluated."""
    request = {"operation": operation, "scope": account_scope, "boundary": boundary,
               "idempotencyKey": idempotency_key}
    body = {"operation": operation, "account_scope": account_scope, "boundary": boundary,
        "registry_hash": registry_hash(), "spec_hashes": sorted({item.spec_hash for item in required}),
        "observation_hashes": sorted({item.observation_hash for item in observations}),
        "idempotency_key": idempotency_key, "request_hash": digest(request)}
    return CertificationInputManifest(**body, manifest_hash=digest(body))


def _reason(spec, observation, now, boundary, latches):
    if not observation: return "observation_missing"
    if observation.scope != spec.scope or observation.version != spec.version: return "scope_or_version_mismatch"
    if observation.boundary != boundary: return "boundary_mismatch"
    if observation.identity != spec.identity: return "identity_drift"
    chain_bound = spec.domain == "chain:42161" or spec.artifact_type in {"runtime", "direct", "uups", "transparent", "beacon", "beacon_implementation"}
    if observation.finality not in ({"safe", "finalized"} if chain_bound else {"pending", "safe", "finalized"}): return "finality_unavailable"
    policy_expiry = min(spec.expires_at, observation.observed_at + timedelta(seconds=spec.freshness_seconds))
    if observation.observed_at > now or observation.expires_at > policy_expiry:
        return "observation_expiry_exceeds_policy"
    if observation.expires_at <= now or spec.expires_at <= now: return "stale_or_expired"
    if spec.revoked_at and spec.revoked_at <= now: return "spec_revoked"
    if spec.artifact_id in latches: return "drift_latched"
    return None


def evaluate(operation: str, account_scope: ArtifactScope, observations: Iterable[ArtifactObservation], now: datetime,
             idempotency_key: str, latches: set[str] | None = None, boundary: str = "prepare") -> CertificationDecision:
    latches = latches if latches is not None else set()
    required = closure(operation, account_scope)
    observed = tuple(observations)
    by_id = {item.artifact_id: item for item in observed}
    reasons, expiry = [], now + timedelta(minutes=5)
    duplicates = {item.artifact_id for item in observed if sum(
        other.artifact_id == item.artifact_id for other in observed) > 1}
    if duplicates:
        reasons.append("duplicate_observation")
    for spec in required:
        observation = by_id.get(spec.artifact_id); reason = _reason(spec, observation, now, boundary, latches)
        if observation: expiry = min(expiry, spec.expires_at, observation.expires_at)
        if reason:
            reasons.append(reason)
            if reason in {"identity_drift", "finality_unavailable", "stale_or_expired", "observation_expiry_exceeds_policy"}:
                latches.add(spec.artifact_id)
    extra = {item.artifact_id for item in observed if item.boundary == boundary} - {item.artifact_id for item in required}
    if extra: reasons.append("unexpected_observation")
    graph_hash = digest({"registryHash": registry_hash(), "operation": operation, "scope": account_scope,
        "specHashes": [item.spec_hash for item in required], "observationHashes": sorted(item.observation_hash for item in observed)})
    outcome, lanes = ("pass", []) if not reasons else ("block", [])
    if reasons and operation not in {"emergency_close", "read_only_reconcile"}:
        close_ids = {item.artifact_id for item in closure("emergency_close", account_scope)}
        reconcile_ids = {item.artifact_id for item in closure("read_only_reconcile", account_scope)}
        close = evaluate("emergency_close", account_scope, (item for item in observed if item.artifact_id in close_ids), now, idempotency_key + ":close", latches, "close")
        reconcile = evaluate("read_only_reconcile", account_scope, (item for item in observed if item.artifact_id in reconcile_ids), now, idempotency_key + ":reconcile", latches, "reconcile")
        if close.outcome == reconcile.outcome == "pass": outcome, lanes = "close_only", ["close", "reconcile"]
    spec_manifest = digest([item.spec_hash for item in required])
    observation_manifest = digest(sorted(item.observation_hash for item in observed))
    manifest = frozen_manifest(operation, account_scope, boundary, required, observed, idempotency_key)
    body = {"operation": operation, "account_scope": account_scope, "venue_ref": "fixture", "route_ref": "fixture", "grant_ref": "fixture", "equivalence_ref": "fixture", "outcome": outcome, "reasons": sorted(set(reasons)) or ["certified"], "permitted_lanes": lanes, "graph_hash": graph_hash, "spec_manifest_hash": spec_manifest, "observation_manifest_hash": observation_manifest, "evaluated_at": now, "expires_at": max(expiry, now + timedelta(seconds=1)), "idempotency_key": idempotency_key}
    body["input_manifest_hash"] = manifest.manifest_hash
    body["request_hash"] = manifest.request_hash
    return CertificationDecision(**body, decision_hash=digest(body))


def drift_event(spec, prior: ArtifactObservation | None, current: ArtifactObservation, now: datetime) -> DriftEvent:
    dependants = ["equivalence", "grant", "preparation", "route"]
    body = {"artifact_id": spec.artifact_id, "scope": spec.scope, "drift_class": "identity" if current.identity != spec.identity else "finality_reorg", "prior_observation_hash": prior.observation_hash if prior else None, "current_observation_hash": current.observation_hash, "affected_dependants": dependants, "first_detected_at": now, "last_detected_at": now, "latch_state": "latched", "invalidation_set_hash": digest(dependants)}
    return DriftEvent(**body, drift_hash=digest(body))


def invalidation_receipts(decision: CertificationDecision, drift_hash: str) -> list[dict]:
    return [{"dependentKind": kind, "state": "invalidated", "predecessorHash": decision.decision_hash, "driftHash": drift_hash,
             "receiptHash": digest({"kind": kind, "decision": decision.decision_hash, "drift": drift_hash})}
            for kind in ("route", "grant", "equivalence", "preparation")]
