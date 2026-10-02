"""Executable fixture corpus. Expectations are compared after real evaluation."""
from __future__ import annotations

from datetime import datetime, timedelta

from .execution_artifact_contracts import ArtifactScope, digest
from .execution_artifact_evaluator import evaluate, frozen_manifest, make_observation
from .execution_artifact_registry import closure

_MATRIX = {
    "artifact-healthy-direct": ("uniswap_trading_prepare", "none", "pass"),
    "artifact-runtime-drift-close-only": ("uniswap_trading_prepare", "identity", "close_only"),
    "artifact-pending-block": ("uniswap_trading_prepare", "pending", "close_only"),
    "artifact-reconcile-survives-submit-drift": ("read_only_reconcile", "none", "pass"),
    "artifact-close-root": ("emergency_close", "none", "pass"),
    "artifact-stale-observation": ("uniswap_trading_prepare", "stale", "close_only"),
    "artifact-reorg": ("uniswap_trading_prepare", "reorg", "close_only"),
    "artifact-missing": ("uniswap_trading_prepare", "missing", "close_only"),
    "artifact-extra": ("uniswap_trading_prepare", "extra", "close_only"),
    "artifact-drift-back-latched": ("uniswap_trading_prepare", "latched", "close_only"),
}
for _operation in ("uniswap_trading_submit", "uniswap_reconcile"):
    _MATRIX[f"artifact-{_operation.replace('_', '-')}-healthy"] = (_operation, "none", "pass")


def scenario_registry() -> list[dict]:
    entries = [{"id": key, "operation": value[0], "fault": value[1], "expected": value[2]}
        for key, value in sorted(_MATRIX.items())]
    pairs = [(item["operation"], item["fault"]) for item in entries]
    if len(pairs) != len(set(pairs)):
        raise ValueError("Artifact scenario corpus aliases an exercised mutation")
    return entries


def _observations(scope, now, manifest):
    result = []
    for operation, boundary in (("uniswap_trading_prepare", "prepare"), ("emergency_close", "close"), ("read_only_reconcile", "reconcile")):
        result.extend(make_observation(spec, boundary, now, manifest) for spec in closure(operation, scope))
    return result


def evaluate_fixture(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str) -> dict:
    fixture = _MATRIX.get(scenario_id)
    if not fixture: raise ValueError("Unknown checked-in execution artifact scenario")
    operation, fault, expected = fixture; scope = ArtifactScope(kind="account", key="account:fixture")
    manifest = digest({"scenario": scenario_id, "operator": operator, "run": run_hash})
    observations = _observations(scope, now, manifest); latches: set[str] = set()
    target = next((spec for spec in closure(operation, scope) if spec.artifact_id == "universal-router"), closure(operation, scope)[0])
    if fault == "identity": observations = [make_observation(target, "prepare", now, manifest, {"fixtureHash": "0" * 64}) if item.artifact_id == target.artifact_id else item for item in observations]
    if fault == "pending": observations = [make_observation(target, "prepare", now, manifest, finality="pending") if item.artifact_id == target.artifact_id else item for item in observations]
    if fault == "stale": observations = [make_observation(target, "prepare", now - timedelta(minutes=10), manifest) if item.artifact_id == target.artifact_id else item for item in observations]
    if fault == "reorg": observations = [make_observation(target, "prepare", now, manifest, finality="reorged", parent_hash="conflict") if item.artifact_id == target.artifact_id else item for item in observations]
    if fault == "missing": observations = [item for item in observations if item.artifact_id != target.artifact_id]
    if fault == "extra": observations.append(make_observation(target, "prepare", now, manifest).model_copy(update={"artifact_id": "extra-artifact"}))
    if fault == "latched": latches.add(target.artifact_id)
    boundary = "close" if operation in {"emergency_close", "gmx_close"} else "reconcile" if operation in {"read_only_reconcile", "uniswap_reconcile", "gmx_reconcile"} else "prepare"
    if boundary in {"close", "reconcile"}:
        ids = {spec.artifact_id for spec in closure(operation, scope)}
        observations = [item for item in observations if item.artifact_id in ids]
    key = f"artifact:{run_hash[:48]}"
    decision = evaluate(operation, scope, observations, now, key, latches, boundary)
    frozen = frozen_manifest(operation, scope, boundary, closure(operation, scope), observations, key)
    return {"_decision": decision, "_inputManifest": frozen, "scenarioId": scenario_id, "fixtureHash": manifest, "baselineOutcome": "unavailable", "candidateOutcome": decision.outcome,
        "actualOutcome": decision.outcome, "operationProfile": operation, "topology": "fixture", "boundary": boundary,
        "resolvedCount": len(observations), "requiredCount": len(closure(operation, scope)), "finality": fault if fault != "none" else "finalized",
        "permittedLanes": decision.permitted_lanes, "invalidationCounts": 4 if decision.outcome == "close_only" else 0,
        "latchState": "latched" if fault in {"identity", "pending", "stale", "reorg", "latched"} else "clear", "requalificationState": "not_requested",
        "decisionHash": decision.decision_hash, "graphHash": decision.graph_hash, "productOutcome": "unavailable", "reasons": decision.reasons,
        "invariantVerdict": "pass" if decision.outcome == expected else "fail"}
