"""Pure conservative reduction.  It can issue only local fixture states."""
from __future__ import annotations
from .selective_prediction_calibrator import fit, project
from .selective_prediction_canonical import digest
from .selective_prediction_contracts import ForecastObservation
from .selective_prediction_registry import registry_hash, scenarios
from .selective_prediction_shift import classify

def _observations(count: int = 200):
    rows = []
    for index in range(count):
        actual = ("long", "short", "neutral")[index % 3]
        probabilities = (9200, 400, 400) if actual == "long" else (400, 9200, 400) if actual == "short" else (400, 400, 9200)
        stamp = f"2026-01-{1 + index // 24:02d}T{index % 24:02d}:00:00Z"
        end = f"2026-02-{1 + index // 24:02d}T{index % 24:02d}:00:00Z"
        rows.append(ForecastObservation(observation_hash=digest({"observation": index}), decision_at=stamp,
            horizon_ends_at=end, probabilities_bps=probabilities, forecast_return_bps=600,
            realized_class=actual, realized_return_bps=600, label_observed_at="2026-03-01T00:00:00Z"))
    return tuple(rows)

def evaluate(identifier: str, mode: str, operator: str, run_hash: str, bindings: dict | None = None, controls=None):
    del controls
    if mode not in {"observe", "enforce"}: raise ValueError("selective_prediction_mode")
    item = next((row for row in scenarios() if row["id"] == identifier), None)
    if not item: raise ValueError("selective_prediction_unknown_scenario")
    required = {"manipulation-aware-evidence-integrity", "portfolio-aware-sizing", "outcome-calibrated-promotion"}
    kind, reasons = item["family"], []
    state, sample = "proposal_eligible", 200
    if not bindings or set(bindings) != required or any(value.get("trustStatus") != "requires_revalidation" or not value.get("zeroAttempts") or not value.get("notAuthorizing") for value in bindings.values()):
        state = "abstain"; reasons.append("PREREQUISITE_CLOSURE")
    if kind == "boundary": state = "abstain"; reasons.append("MALFORMED_OR_PROHIBITED")
    if kind in {"sparse", "stale", "outside", "conflict", "cost", "risk", "width", "multi", "corrected"}:
        state = "abstain"; reasons.append({"sparse":"INSUFFICIENT_LABELS", "stale":"ARTIFACT_STALE", "outside":"SHIFT_OUTSIDE", "conflict":"CLAIM_CONFLICT", "cost":"NET_EDGE_NONPOSITIVE", "risk":"RISK_DENY", "width":"INTERVAL_EXCESSIVE", "multi":"NON_SINGLETON_SET", "corrected":"ARTIFACT_CORRECTED"}[kind])
        if kind == "sparse": sample = 8
    threshold, residual = fit(_observations())
    direction_set, lower, upper = project((9200, 400, 400), 600, threshold, residual)
    shift = classify(0 if kind != "outside" else 1200, 0, 0)
    if kind == "warning" and state != "abstain": state = "shadow_only"; reasons.append("SHIFT_WARNING")
    effective = "shadow_only" if mode == "observe" and state == "proposal_eligible" else state
    root = digest({"scenario": item, "operator": operator, "run": run_hash, "bindings": bindings,
        "effective": effective, "reasons": reasons, "threshold": threshold, "residual": residual})
    return {"scenarioId": identifier, "fixtureHash": digest(item), "registryHash": registry_hash(), "invariantVerdict": "pass",
        "fixtureOnly": True, "productOutcome": "unavailable", "authorityEffect": "none", "proposalCreated": False,
        "requestedMode": mode, "effectiveState": effective, "wouldState": state, "reasons": reasons,
        "market": "ETH-USD", "horizon": item["horizon"], "rawSampleCount": sample, "effectiveSampleCount": sample,
        "targetCoverageBps": 9000, "empiricalCoverageBps": 10000, "directionSet": list(direction_set),
        "returnIntervalBps": [lower, upper], "shiftState": shift, "artifactHash": digest({"artifact": identifier}),
        "cohortHash": digest({"cohort": identifier}), "receiptHash": digest({"receipt": identifier}),
        "selectedPrerequisiteStatus": "requires_revalidation", "providerAttempts": 0, "externalAttempts": 0,
        "networkAttempts": 0, "workflowAttempts": 0, "signerAttempts": 0, "walletAttempts": 0, "venueAttempts": 0,
        "executionAttempts": 0, "creditAttempts": 0, "providerCost": 0, "rootHash": root,
        "_artifacts": {"rootHash": root, "scenario": item}}
