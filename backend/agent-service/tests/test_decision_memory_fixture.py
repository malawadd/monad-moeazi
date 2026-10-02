from datetime import datetime, timezone
import pytest

from moeazi_agent.decision_memory_canonical import load
from moeazi_agent.decision_memory_scenarios import evaluate_fixture, scenario_registry


def test_checked_in_corpus_is_bounded_and_local_only():
    assert len(scenario_registry()) == 96
    result = evaluate_fixture("decision-memory-001", "enforce", datetime.now(timezone.utc), "operator_fixture", "a" * 64, {"trustStatus": "requires_revalidation"})
    assert result["maturity"] == "mature"
    assert result["fixtureOnly"] and result["providerAttempts"] == result["externalAttempts"] == 0


def test_pending_and_disputed_facts_are_not_retrieved():
    for identifier in ("decision-memory-002", "decision-memory-003", "decision-memory-004"):
        result = evaluate_fixture(identifier, "enforce", datetime.now(timezone.utc), "operator_fixture", "b" * 64, {"trustStatus": "requires_revalidation"})
        assert result["retrievalStatus"] == "empty"


def test_duplicate_json_and_float_are_rejected():
    with pytest.raises(ValueError): load('{"a":1,"a":2}')
    with pytest.raises(ValueError): load('{"a":1.1}')
