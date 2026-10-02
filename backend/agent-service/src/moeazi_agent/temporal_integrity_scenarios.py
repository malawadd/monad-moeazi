"""Frozen temporal-integrity fixture scenarios executed by the real evaluator."""
from __future__ import annotations
import json
from datetime import datetime
from importlib.resources import files
from .temporal_integrity_contracts import CausalLink, SequencePoint, TemporalScope, ValidityInterval, digest
from .temporal_integrity_evaluator import evaluate, fixture_observation, frozen_manifest
from .temporal_integrity_inventory import inventory_hash
from .temporal_integrity_nonce import FixtureNonceAllocator
from .temporal_integrity_registry import operation_spec, registry_hash

_CASES = {
    "temporal-interior-allow": ("prepare", "healthy"),
    "temporal-expiry-equality-block": ("prepare", "expiry"),
    "temporal-wide-uncertainty-block": ("prepare", "wide"),
    "temporal-rollback-block": ("submit", "rollback"),
    "temporal-timestamp-only-block": ("sign", "no_cause"),
    "temporal-nonce-conflict-block": ("submit", "nonce"),
    "temporal-reconcile-safe-lane": ("reconcile", "uncertain"),
    "temporal-close-safe-lane": ("close", "uncertain"),
}
def _expectations() -> dict[str, str]:
    value = json.loads(files("moeazi_agent").joinpath(
        "temporal_integrity_expectations.json").read_text(encoding="utf-8"))
    if set(value) != {"schemaVersion", "expectations"} or value["schemaVersion"] != 1 \
            or set(value["expectations"]) != set(_CASES):
        raise ValueError("Temporal scenario expectations are not closed")
    return value["expectations"]

def scenario_registry() -> list[dict]: return [{"id": key, "operation": value[0]} for key, value in sorted(_CASES.items())]

def evaluate_fixture(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str) -> dict:
    operation, fault = _CASES[scenario_id]; expected = _expectations()[scenario_id]
    spec = operation_spec(operation); scope = TemporalScope(key="account:fixture")
    now_us = int(now.timestamp() * 1_000_000)
    status = fault if fault in {"rollback", "restart", "disputed"} else \
        "uncertain" if fault == "uncertain" else "healthy"
    observation = fixture_observation(spec, scope, now_us, now, status)
    if fault == "wide":
        body = observation.model_dump(exclude={"observation_hash"})
        body.update(latest_us=now_us + spec.max_uncertainty_us + 1,
                    source_latest_us=now_us + spec.max_uncertainty_us + 1,
                    uncertainty_us=spec.max_uncertainty_us + 1)
        observation = observation.__class__(**body, observation_hash=digest(body))
    start, end = now_us - 1, now_us + 10_000_000
    if fault == "expiry": end = now_us
    interval_body = {"domain_id": spec.domain_id, "subject_hash": digest({"scenario": scenario_id}), "valid_from_us": start, "valid_until_us": end}
    interval = ValidityInterval(**interval_body, interval_hash=digest(interval_body))
    sequence_kind = {"chain": "chain", "venue_sequence": "venue", "workflow": "workflow"}.get(spec.domain_type, "process")
    proof_kind = {"chain": "block_ancestor", "venue_sequence": "native_sequence",
                  "workflow": "workflow_history"}.get(spec.domain_type, "same_operation")
    sequence = SequencePoint(kind=sequence_kind, epoch=spec.epoch, counter=1,
        event_hash=digest({"event": scenario_id}))
    causal_body = {"predecessor_hash": digest({"before": scenario_id}), "successor_hash": sequence.event_hash,
        "proof_kind": proof_kind, "source_evidence_hash": digest({"fixture": scenario_id})}
    causal = CausalLink(**causal_body, link_hash=digest(causal_body))
    nonce = None
    if operation in {"sign", "submit"}:
        allocator = FixtureNonceAllocator(); nonce = allocator.reserve(spec.domain_id, "a" * 16, "account:fixture", operation, digest({"run": run_hash}), f"nonce:{run_hash[:48]}")
        if fault == "nonce":
            nonce_body = nonce.model_dump(exclude={"lease_hash"})
            nonce_body["operation"] = "sign"
            nonce = nonce.__class__(**nonce_body, lease_hash=digest(nonce_body))
    scenario_hash = digest({"scenario": scenario_id, "run": run_hash})
    key = f"temporal:{run_hash[:48]}"
    selected_sequence = sequence if fault != "no_cause" else None
    selected_causal = causal if fault != "no_cause" else None
    decision = evaluate(operation, scope, spec, observation, interval, selected_sequence,
        selected_causal, nonce, now, key, registry_hash(), inventory_hash(), scenario_hash)
    manifest = frozen_manifest(operation, scope, spec, observation, interval, selected_sequence,
        selected_causal, nonce, key, registry_hash(), inventory_hash(), scenario_hash)
    return {"_decision": decision, "_inputManifest": manifest, "fixtureHash": digest({"scenario": scenario_id, "run": run_hash, "registry": registry_hash()}),
        "baselineOutcome": "unavailable", "candidateOutcome": decision.outcome, "actualOutcome": decision.outcome,
        "domainType": spec.domain_type, "uncertaintyUs": observation.uncertainty_us,
        "intervalRelation": "contained" if decision.outcome == "allow" else "unsafe_or_ambiguous",
        "causalProof": causal.proof_kind if fault != "no_cause" else "missing", "nonceLeaseState": nonce.state if nonce else "not-required",
        "permittedLanes": ["reconcile"] if operation == "reconcile" else ["close"] if operation == "close" else [],
        "decisionHash": decision.decision_hash, "registryHash": registry_hash(), "productOutcome": "unavailable",
        "reasons": decision.reasons, "invariantVerdict": "pass" if decision.outcome == expected else "fail"}
