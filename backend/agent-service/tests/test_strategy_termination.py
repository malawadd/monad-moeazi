from datetime import datetime, timezone
import json
from importlib.resources import files
import pytest
from moeazi_agent.strategy_termination_canonical import digest, json_loads_strict
from moeazi_agent.strategy_termination_evaluator import RISK_INCREASING
from moeazi_agent.strategy_termination_registry import raw, registry_hash
from moeazi_agent.strategy_termination_scenarios import evaluate_fixture, scenario_registry

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)
PREREQUISITES = {name: {"runId": f"run-{digest({'feature': name})[:32]}", "runHash": digest({"run": name}),
    "bundleHash": digest({"bundle": name}), "controlHash": digest({"control": name}), "registryHash": digest({"registry": name})}
    for name in ("cross-state-recovery-continuity", "intent-execution-equivalence")}

def test_checked_in_corpus_reaches_expected_state_without_external_effects():
    expected = json.loads(files("moeazi_agent").joinpath("strategy_termination_expectations.json").read_text())
    for scenario in scenario_registry():
        result = evaluate_fixture(scenario["id"], "observe", NOW, "operator:fixture", "a" * 64, prerequisites=PREREQUISITES)
        assert result["actualOutcome"] == expected[scenario["id"]]
        assert result["invariantVerdict"] == "pass"
        assert result["productOutcome"] == "unavailable" and result["externalAttempts"] == 0

def test_identical_fixture_is_deterministic_and_post_latch_increases_fail_closed():
    left = evaluate_fixture("clean-full", "enforce", NOW, "operator:fixture", "b" * 64, prerequisites=PREREQUISITES)
    right = evaluate_fixture("clean-full", "enforce", NOW, "operator:fixture", "b" * 64, prerequisites=PREREQUISITES)
    assert left["decisionHash"] == right["decisionHash"]
    assert set(left["_latch"].denied_operations) >= RISK_INCREASING
    blocked = evaluate_fixture("post-latch-submit", "enforce", NOW, "operator:fixture", "b" * 64, prerequisites=PREREQUISITES)
    assert blocked["automationStopVerified"] is False and blocked["completionHash"] is None

def test_registry_and_canonical_parser_reject_drift_and_duplicate_keys():
    assert raw()["operations"] == sorted(raw()["operations"])
    assert len(registry_hash()) == 64 and digest({"a": 1}) == digest({"a": 1})
    with pytest.raises(ValueError, match="duplicate"):
        json_loads_strict('{"a":1,"a":2}')

def test_prerequisite_selection_and_no_authority_tripwires():
    with pytest.raises(ValueError, match="persisted Feature 02"):
        evaluate_fixture("clean-full", "observe", NOW, "operator:fixture", "a" * 64)
    source = files("moeazi_agent").joinpath("strategy_termination_scenarios.py").read_text()
    assert not any(token in source for token in ("requests", "httpx", "web3", "subprocess", "Temporal", "Convex"))
