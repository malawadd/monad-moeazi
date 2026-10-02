"""Pure fail-closed parity evaluator for three frozen inert observations."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from .intent_equivalence_canonical import digest, exact_uint
from .intent_equivalence_contracts import (DecodedExecutionPlan, DispatchArtifactObservation, EquivalenceCheck,
    IntentEquivalenceReceipt, ObservedStateDelta, ReviewedExecutionEnvelope, ReviewedIntent, SyntheticSimulationContext)
from .intent_equivalence_registry import raw

PRECEDENCE = {"pass": 0, "unknown": 1, "fail": 2}

def _check(path: str, comparator: str, reviewed: str | None, observed: str | None, outcome: str, reason: str) -> EquivalenceCheck:
    body = {"path": path, "comparator": comparator, "reviewed": reviewed, "observed": observed, "outcome": outcome, "reason_code": reason}
    return EquivalenceCheck(**body, check_hash=digest(body))

def _eq(path: str, reviewed: str, observed: str) -> EquivalenceCheck:
    return _check(path, "exact", reviewed, observed, "pass" if reviewed == observed else "fail", "exact_match" if reviewed == observed else "exact_mismatch")

def evaluate(intent: ReviewedIntent, envelope: ReviewedExecutionEnvelope, artifacts: list[DispatchArtifactObservation],
             plan: DecodedExecutionPlan, context: SyntheticSimulationContext, deltas: list[ObservedStateDelta], now: datetime) -> tuple[IntentEquivalenceReceipt, list[EquivalenceCheck]]:
    """Return only a receipt for fixture evidence. Any missing/ambiguous field is unknown."""
    checks: list[EquivalenceCheck] = []
    if len(artifacts) != 3 or [item.stage for item in artifacts] != ["prepared", "signing_request", "dispatch"]:
        checks.append(_check("/stages", "ordered_three_stage", "prepared,signing_request,dispatch", ",".join(item.stage for item in artifacts), "fail", "stage_set_mismatch"))
    else:
        for item in artifacts: checks.extend([_eq(f"/{item.stage}/envelope", envelope.envelope_hash, item.envelope_hash), _eq(f"/{item.stage}/chain", "42161", str(item.chain_id))])
        hashes = [item.artifact_hash for item in artifacts]
        checks.append(_check("/stages/artifact", "exact_parity", hashes[0], digest(hashes), "pass" if len(set(hashes)) == 1 else "fail", "stage_parity" if len(set(hashes)) == 1 else "stage_artifact_mismatch"))
    checks += [_eq("/envelope/intent", intent.intent_hash, envelope.intent_hash), _eq("/scope", intent.scope.scope_hash, envelope.scope.scope_hash)]
    if plan.complete:
        checks += [_eq("/plan/target", intent.target_hash, plan.target_hashes[0] if len(plan.target_hashes) == 1 else ""),
            _eq("/plan/recipient", intent.recipient_hash, plan.recipient_hashes[0] if len(plan.recipient_hashes) == 1 else "")]
    checks.append(_check("/plan/complete", "true", "true", str(plan.complete).lower(), "pass" if plan.complete else "unknown", "complete" if plan.complete else "incomplete_decode"))
    context_outcome = "fail" if context.scope_hash != intent.scope.scope_hash else "pass" if context.block_hash and context.expires_at >= now else "unknown"
    checks.append(_check("/context/pinned", "fresh_pinned", intent.scope.scope_hash, context.scope_hash, context_outcome,
        "fresh_pinned" if context_outcome == "pass" else "context_scope_mismatch" if context_outcome == "fail" else "unpinned_or_stale_context"))
    if plan.complete:
        for path, observed, bound in (("/input", plan.max_input, intent.max_input), ("/value", plan.max_value, intent.max_value), ("/gas", plan.max_gas, intent.max_gas)):
            result = "pass" if exact_uint(observed) <= exact_uint(bound) else "fail"
            checks.append(_check(path, "lte", bound, observed, result, "within_bound" if result == "pass" else "bound_exceeded"))
        output = "pass" if exact_uint(plan.min_output) >= exact_uint(intent.min_output) else "fail"
        checks.append(_check("/output", "gte", intent.min_output, plan.min_output, output, "protected_output" if output == "pass" else "output_weakened"))
    deadline = "pass" if plan.deadline <= intent.deadline and plan.deadline >= now and intent.expires_at >= now and envelope.expires_at >= now else "fail"
    checks.append(_check("/deadline", "live_lte", intent.deadline.isoformat(), plan.deadline.isoformat(), deadline, "deadline_valid" if deadline == "pass" else "deadline_invalid"))
    unexpected = [item for item in deltas if item.classification == "unexplained"]
    coverage = "pass" if deltas and not unexpected and len(deltas) <= raw()["stateDeltas"] else "unknown"
    checks.append(_check("/deltas", "complete_expected", None, str(len(deltas)), coverage, "delta_closure" if coverage == "pass" else "unexplained_or_incomplete_delta"))
    outcomes = [item.outcome for item in checks]; outcome = max(outcomes, key=PRECEDENCE.__getitem__)
    reasons = sorted({item.reason_code for item in checks if item.outcome != "pass"})
    stage_parity = digest([item.artifact_hash for item in artifacts])
    body = {"scope_hash": intent.scope.scope_hash, "envelope_hash": envelope.envelope_hash, "artifact_hashes": [item.artifact_hash for item in artifacts],
        "plan_hash": plan.plan_hash, "context_hash": context.context_hash, "delta_hashes": [item.delta_hash for item in deltas],
        "check_hashes": [item.check_hash for item in checks], "stage_parity_hash": stage_parity, "registry_hash": envelope.registry_hash,
        "corpus_hash": envelope.corpus_hash, "repository_sha": envelope.repository_sha, "issued_at": now,
        "expires_at": min(envelope.expires_at, context.expires_at, now + timedelta(seconds=raw()["receiptTtlSeconds"])), "outcome": outcome, "reasons": reasons}
    return IntentEquivalenceReceipt(**body, receipt_hash=digest(body)), checks
