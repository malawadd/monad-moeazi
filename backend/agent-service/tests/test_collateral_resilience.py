from datetime import datetime, timezone
import pytest
from moeazi_agent.collateral_resilience_canonical import integer
from moeazi_agent.collateral_resilience_evaluator import floor_div
from moeazi_agent.collateral_resilience_registry import raw
from moeazi_agent.collateral_resilience_scenarios import evaluate_fixture, scenario_registry

NOW = datetime(2026, 9, 5, tzinfo=timezone.utc)

def test_closed_corpus_replays_without_external_authority():
    assert raw()["prohibited"]["externalNetwork"] is True
    results = [evaluate_fixture(item["id"], "observe", NOW, "operator", "a" * 64) for item in scenario_registry()]
    assert len(results) >= 40
    assert all(item["invariantVerdict"] == "pass" for item in results)
    assert {item["actualOutcome"] for item in results} == {"pass", "close_only", "block", "unknown"}
    assert all(item["productOutcome"] == "unavailable" for item in results)

def test_integer_canonicalization_and_flooring_are_strict():
    assert floor_div(9, 2) == 4
    with pytest.raises(ValueError): integer("01")
    with pytest.raises(ValueError): integer("1.0")
    with pytest.raises(ValueError): floor_div(1, 0)

def test_bad_evidence_never_becomes_a_pass_and_feature12_is_context_only():
    stale = evaluate_fixture("stale-liquidity", "enforce", NOW, "operator", "b" * 64)
    unsafe = evaluate_fixture("issuer-halt", "enforce", NOW, "operator", "c" * 64)
    lane = evaluate_fixture("halted-safe-close", "enforce", NOW, "operator", "d" * 64)
    assert stale["actualOutcome"] == "unknown"
    assert unsafe["actualOutcome"] == "block"
    assert lane["actualOutcome"] == "close_only" and lane["safeLanes"] == ["close"]
    assert all(item["feature12Status"] == "requires_revalidation" for item in (stale, unsafe, lane))
