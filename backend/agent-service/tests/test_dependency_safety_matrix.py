from datetime import datetime, timedelta, timezone
from time import perf_counter

import pytest
from pydantic import ValidationError

from moeazi_agent.dependency_safety_contracts import (
    DependencyHealthReceipt, DependencyStatus, SafetyOperation, SafetyScope,
)
from moeazi_agent.dependency_safety_matrix import (
    build_receipt, evaluate_safety, requirements_for, verify_health_receipt,
    verify_safety_decision,
)


NOW = datetime(2026, 8, 6, 12, 0, tzinfo=timezone.utc)
BINDINGS = {"venue": "uniswap", "source": "fixture", "account": "acct-a"}


def scope(kind: str = "account", account: str = "acct-a") -> SafetyScope:
    values = {
        "global": {"kind": "global", "key": "global"},
        "tenant": {"kind": "tenant", "key": "tenant:tenant-a", "tenant_id": "tenant-a"},
        "account": {"kind": "account", "key": f"account:{account}", "strategy_account_id": account},
        "venue": {"kind": "venue", "key": f"account:{account}:venue:uniswap",
                  "strategy_account_id": account, "venue": "uniswap"},
        "market": {"kind": "market", "key": f"account:{account}:market:ETH-USDC",
                   "strategy_account_id": account, "market": "ETH-USDC"},
        "workflow": {"kind": "workflow", "key": f"account:{account}:workflow:workflow-a",
                     "strategy_account_id": account, "workflow_id": "workflow-a"},
    }
    return SafetyScope(**values[kind])


def bindings_for(operation: SafetyOperation) -> dict[str, str]:
    if operation is SafetyOperation.INGEST:
        return {"source": "fixture", "market": "ETH-USDC"}
    if operation is SafetyOperation.ANALYZE:
        return {"market": "ETH-USDC"}
    if operation is SafetyOperation.RENDER_PREVIOUS:
        return {"market": "ETH-USDC", "snapshot_hash": "b" * 64}
    if operation is SafetyOperation.RECONCILE:
        return {"venue": "uniswap", "account": "acct-a"}
    if operation is SafetyOperation.SIMULATE:
        return {"venue": "uniswap", "account": "acct-a", "market": "ETH-USDC",
                "analysis_id": "analysis-a", "quote_reference": "quote-a"}
    if operation in {SafetyOperation.PREFLIGHT, SafetyOperation.SUBMIT}:
        return {"venue": "uniswap", "account": "acct-a", "market": "ETH-USDC",
                "analysis_id": "analysis-a", "policy_version": "1",
                "quote_reference": "quote-a"}
    return {"market": "ETH-USDC", "analysis_decision_hash": "a" * 64,
            "policy_version": "1"}


def receipts_for(
    operation: SafetyOperation, target: SafetyScope,
    changed: str | None = None, status: DependencyStatus = DependencyStatus.HEALTHY,
):
    result = []
    for dependency in requirements_for(operation, bindings_for(operation)):
        result.append(build_receipt(
            dependency, target, status if dependency == changed else DependencyStatus.HEALTHY,
            NOW, "fixture_status", "fixture-r1", "fixture-v1", f"obs:{dependency}",
        ))
    return result


def decide(operation, target, receipts, mode="enforce"):
    return evaluate_safety(
        operation, target, f"subject:{operation.value}", receipts,
        bindings_for(operation), f"idem:{operation.value}", NOW, mode,
        request_hash="a" * 64,
    )


@pytest.mark.parametrize("operation", list(SafetyOperation))
@pytest.mark.parametrize("kind", ["global", "tenant", "account", "venue", "market", "workflow"])
def test_all_operations_allow_only_complete_healthy_receipts(operation, kind):
    target = scope(kind)
    assert decide(operation, target, receipts_for(operation, target)).outcome == "allow"
    for dependency in requirements_for(operation, bindings_for(operation)):
        for status in (
            DependencyStatus.DEGRADED, DependencyStatus.OPEN,
            DependencyStatus.UNKNOWN, DependencyStatus.STALE,
        ):
            assert decide(
                operation, target, receipts_for(operation, target, dependency, status),
            ).outcome == "block"


def test_missing_and_expired_receipts_fail_closed_at_ttl_boundary():
    target = scope()
    operation = SafetyOperation.PREFLIGHT
    complete = receipts_for(operation, target)
    assert decide(operation, target, complete[:-1]).outcome == "block"
    expired_at_boundary = evaluate_safety(
        operation, target, "subject:preflight", complete,
        bindings_for(operation), "idem:preflight", NOW + timedelta(seconds=60), "enforce",
        request_hash="a" * 64,
    )
    assert expired_at_boundary.outcome == "block"
    assert any(reason.startswith("stale:") for reason in expired_at_boundary.reasons)


def test_broad_failure_dominates_narrow_health_and_other_accounts_are_isolated():
    target = scope("account", "acct-a")
    operation = SafetyOperation.ANALYZE
    healthy = receipts_for(operation, target)
    dependency = requirements_for(operation, bindings_for(operation))[0]
    global_open = build_receipt(
        dependency, scope("global"), DependencyStatus.OPEN, NOW,
        "global_outage", "r1", "v1", "global-open",
    )
    assert decide(operation, target, [*healthy, global_open]).outcome == "block"
    other_open = build_receipt(
        dependency, scope("account", "acct-b"), DependencyStatus.OPEN, NOW,
        "other_account_outage", "r1", "v1", "other-open",
    )
    assert decide(operation, target, [*healthy, other_open]).outcome == "allow"


def test_reconciliation_stays_available_during_submit_only_outage():
    target = scope()
    healthy = receipts_for(SafetyOperation.RECONCILE, target)
    submit_outage = build_receipt(
        "live_execution", scope("global"), DependencyStatus.OPEN, NOW,
        "submit_lane_down", "r1", "v1", "submit-down",
    )
    assert decide(SafetyOperation.RECONCILE, target, [*healthy, submit_outage]).outcome == "allow"


def test_hashes_are_deterministic_strict_and_revalidated():
    target = scope()
    receipt = receipts_for(SafetyOperation.RENDER_PREVIOUS, target)[0]
    duplicate = receipts_for(SafetyOperation.RENDER_PREVIOUS, target)[0]
    assert receipt.canonical_hash == duplicate.canonical_hash
    assert receipt.canonical_hash == "42bce0cb12717aa98f9dc31e1e000fb2b1f0d6d79dddac595c051bf2783f95ac"
    verify_health_receipt(receipt)
    decision = decide(SafetyOperation.RENDER_PREVIOUS, target, [receipt])
    assert len(decision.decision_hash) == 64
    verify_safety_decision(
        decision, SafetyOperation.RENDER_PREVIOUS, "subject:render_previous",
        "idem:render_previous", NOW, bindings_for(SafetyOperation.RENDER_PREVIOUS),
        "a" * 64,
    )
    forged = decision.model_copy(update={"decision_hash": "0" * 64})
    with pytest.raises(ValueError, match="hash"):
        verify_safety_decision(
            forged, SafetyOperation.RENDER_PREVIOUS, "subject:render_previous",
            "idem:render_previous", NOW, bindings_for(SafetyOperation.RENDER_PREVIOUS),
            "a" * 64,
        )
    with pytest.raises(ValidationError):
        DependencyHealthReceipt.model_validate({**receipt.model_dump(), "caller_ttl": 10})


def test_observe_records_block_without_granting_fresh_enforcement_authority():
    target = scope()
    decision = decide(SafetyOperation.SUBMIT, target, [], mode="observe")
    assert decision.outcome == "block" and decision.permits(NOW)
    assert not decision.permits(decision.expires_at)
    enforce = decision.model_copy(update={"mode": "enforce"})
    assert not enforce.permits(NOW)


def test_pure_evaluator_p95_is_below_five_ms_locally():
    target = scope()
    receipts = receipts_for(SafetyOperation.SUBMIT, target)
    timings = []
    for index in range(300):
        started = perf_counter()
        evaluate_safety(
            SafetyOperation.SUBMIT, target, "subject", receipts,
            bindings_for(SafetyOperation.SUBMIT), f"idem:{index}", NOW, "enforce",
            request_hash="a" * 64,
        )
        timings.append((perf_counter() - started) * 1_000)
    timings.sort()
    assert timings[int(len(timings) * 0.95)] < 5


@pytest.mark.parametrize("operation", list(SafetyOperation))
def test_v1_only_receipts_never_satisfy_v2_requirements(operation):
    target = scope()
    legacy = [item.model_copy(update={"schema_version": 1})
              for item in receipts_for(operation, target)]
    decision = decide(operation, target, legacy)
    assert decision.outcome == "block"
    assert any(reason.startswith("missing:") for reason in decision.reasons)


def test_v2_request_hash_is_mandatory():
    target = scope()
    with pytest.raises(ValueError, match="request hash"):
        evaluate_safety(SafetyOperation.ANALYZE, target, "subject", [],
            bindings_for(SafetyOperation.ANALYZE), "idem", NOW, "enforce")
