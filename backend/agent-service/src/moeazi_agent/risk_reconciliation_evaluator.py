"""Pure deterministic evaluator for checked-in risk/reconciliation fixtures."""
from __future__ import annotations

from datetime import datetime, timedelta

from .risk_reconciliation_canonical import digest
from .risk_reconciliation_contracts import (RiskInputManifest, RiskObservation, RiskReservation,
    RiskScope, RiskSnapshot)
from .risk_reconciliation_registry import raw, registry_hash


def frozen_manifest(scope: RiskScope, operation: str, observations: list[RiskObservation], now: datetime,
                    key: str, corpus_hash: str, closure_hash: str) -> RiskInputManifest:
    request_hash = digest({"scope": scope, "operation": operation, "idempotencyKey": key,
        "observations": sorted(item.observation_hash for item in observations)})
    body = {"scope": scope, "operation": operation, "registry_hash": registry_hash(), "corpus_hash": corpus_hash,
        "observation_hashes": sorted(item.observation_hash for item in observations), "proposal_hash": digest({"proposal": key}),
        "policy_hash": digest({"policy": "fixture-v1"}), "quote_hash": digest({"quote": "fixture-v1"}),
        "feature08_control_hash": digest({"feature": "08", "control": "fixture"}), "prerequisite_closure_hash": closure_hash,
        "repository_sha": "0" * 40, "frozen_at": now, "idempotency_key": key, "request_hash": request_hash}
    return RiskInputManifest(**body, manifest_hash=digest(body))


def evaluate_snapshot(scope: RiskScope, observations: list[RiskObservation], manifest: RiskInputManifest,
                      now: datetime) -> RiskSnapshot:
    reasons: list[str] = []; source_map: dict[str, RiskObservation] = {}
    if manifest.scope != scope or manifest.operation not in {"snapshot", "reserve", "prepare", "hold", "reconcile"}:
        reasons.append("manifest_scope_or_operation_mismatch")
    if sorted(item.observation_hash for item in observations) != manifest.observation_hashes:
        reasons.append("manifest_observation_mismatch")
    for item in observations:
        if item.scope != scope:
            reasons.append("scope_mismatch"); continue
        if item.source_id in source_map:
            reasons.append("observation_disputed"); continue
        source_map[item.source_id] = item
    for source in raw()["requiredSources"]:
        item = source_map.get(source)
        if not item: reasons.append("observation_missing"); continue
        authority = raw()["sourceAuthorities"][source]
        if (item.owner_kind, item.revision) != (authority["ownerKind"], authority["revision"]):
            reasons.append("source_authority_mismatch")
        if item.status == "missing": reasons.append("observation_missing")
        elif item.status == "disputed": reasons.append("observation_disputed")
        elif item.status != "available" or item.expires_at <= now or item.observed_at > now: reasons.append("observation_stale")
    outcome = "complete" if not reasons else "disputed" if "observation_disputed" in reasons else "missing" if "observation_missing" in reasons else "stale" if "observation_stale" in reasons else "blocked"
    aggregate: dict[str, int] = {}
    for item in source_map.values():
        for key, value in item.values.items(): aggregate[key] = aggregate.get(key, 0) + value
    hashes = {source: source_map[source].observation_hash if source in source_map else "0" * 64 for source in raw()["requiredSources"]}
    body = {"snapshot_id": f"snapshot:{manifest.request_hash[:32]}", "scope": scope, "manifest_hash": manifest.manifest_hash,
        "source_hashes": hashes, "aggregate": {key: aggregate[key] for key in sorted(aggregate)}, "outcome": outcome,
        "safe_lanes": raw()["safeLanes"] if outcome == "complete" else ["reconcile"], "as_of": now,
        "expires_at": now + timedelta(seconds=raw()["snapshotTtlSeconds"])}
    return RiskSnapshot(**body, snapshot_hash=digest(body))


def reservation_from_snapshot(snapshot: RiskSnapshot, manifest: RiskInputManifest, deltas: dict[str, int], now: datetime) -> RiskReservation:
    capacity = snapshot.aggregate.get("capacity", 0)
    requested = sum(deltas.values())
    state = "reserved" if snapshot.outcome == "complete" and requested <= capacity else "conflict"
    body = {"reservation_id": f"reservation:{manifest.request_hash[:32]}", "scope": snapshot.scope,
        "snapshot_hash": snapshot.snapshot_hash, "policy_hash": manifest.policy_hash, "request_hash": manifest.request_hash,
        "idempotency_key": manifest.idempotency_key, "deltas": {key: deltas[key] for key in sorted(deltas)}, "state": state,
        "expires_at": now + timedelta(seconds=raw()["reservationTtlSeconds"])}
    return RiskReservation(**body, reservation_hash=digest(body))
