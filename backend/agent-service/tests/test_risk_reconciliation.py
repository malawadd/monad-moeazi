from datetime import datetime, timezone

import pytest

from moeazi_agent.risk_reconciliation_registry import raw
from moeazi_agent.risk_reconciliation_scenarios import evaluate_fixture, scenario_registry

NOW = datetime(2026, 8, 14, tzinfo=timezone.utc)


def test_fixture_corpus_is_closed_and_safe():
    assert raw()["prohibited"]["liveSubmit"] is True
    results = [evaluate_fixture(item["id"], "observe", NOW, "operator", "a" * 64) for item in scenario_registry()]
    assert results and all(item["invariantVerdict"] == "pass" for item in results)


def test_contracts_reject_float_and_non_arbitrum_scope():
    result = evaluate_fixture("complete-fresh-snapshot", "observe", NOW, "operator", "a" * 64)
    observation = result["_observations"][0]
    body = observation.model_dump(exclude={"observation_hash"}); body["values"] = {"capacity": 1.5}
    with pytest.raises(ValueError): observation.__class__(**body, observation_hash="0" * 64)


def test_source_authority_drift_blocks_a_complete_snapshot():
    result = evaluate_fixture("complete-fresh-snapshot", "observe", NOW, "operator", "a" * 64)
    observation = result["_observations"][0]
    body = observation.model_dump(exclude={"observation_hash"}); body["owner_kind"] = "owner:forged"
    from moeazi_agent.risk_reconciliation_canonical import digest
    forged = observation.__class__(**body, observation_hash=digest(body))
    from moeazi_agent.risk_reconciliation_evaluator import evaluate_snapshot
    observations = [forged, *result["_observations"][1:]]
    assert evaluate_snapshot(result["_snapshot"].scope, observations, result["_manifest"], NOW).outcome == "blocked"
