import copy
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from moeazi_agent.recovery_contracts import RecoveryPointSet
from moeazi_agent.recovery_evaluator import evaluate_recovery_fixture
from moeazi_agent.recovery_restore_contracts import IsolatedRestorePlan, RestoreAttemptReceipt
from moeazi_agent.test_center import load_json

NOW = datetime(2026, 8, 6, 12, 0, tzinfo=timezone.utc)


def artifact_payload(kind: str) -> dict:
    fixture = load_json("recovery_scenarios.json")["scenarios"][0]
    result = evaluate_recovery_fixture(fixture, NOW)
    return copy.deepcopy(next(item["payload"] for item in result["_storageArtifacts"]
        if item["kind"] == kind))


def test_recursive_raw_validator_rejects_nested_float_before_datetime_coercion():
    point = artifact_payload("recovery_point_set")
    point["domain_cutoffs"]["convex_product_state"] = 1.25
    with pytest.raises(ValidationError, match="floating-point"):
        RecoveryPointSet.model_validate(point)


def test_isolated_restore_plan_rejects_duplicated_or_reordered_steps():
    plan = artifact_payload("isolated_restore_plan")
    plan["steps"][1] = "verify_inputs"
    with pytest.raises(ValidationError, match="exact safe sequence"):
        IsolatedRestorePlan.model_validate(plan)


def test_restore_terminal_result_is_equivalent_to_verified_domains_and_zero_side_effects():
    attempt = artifact_payload("restore_attempt_receipt")
    blocked_domain = copy.deepcopy(attempt)
    blocked_domain["domain_results"][0]["status"] = "blocked"
    blocked_domain["domain_results"][0]["reason_codes"] = ["evidence_missing"]
    with pytest.raises(ValidationError, match="terminal result contradicts"):
        RestoreAttemptReceipt.model_validate(blocked_domain)
    outbound = copy.deepcopy(attempt); outbound["outbound_attempt_count"] = 1
    with pytest.raises(ValidationError, match="terminal result contradicts"):
        RestoreAttemptReceipt.model_validate(outbound)
    blocked_without_cause = copy.deepcopy(attempt); blocked_without_cause["terminal_result"] = "blocked"
    with pytest.raises(ValidationError, match="terminal result contradicts"):
        RestoreAttemptReceipt.model_validate(blocked_without_cause)
