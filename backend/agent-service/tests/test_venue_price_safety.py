from datetime import datetime, timedelta, timezone
from pathlib import Path
import pytest

from moeazi_agent.venue_price_canonical import integer, strict_loads
from moeazi_agent.venue_price_evaluator import ppm
from moeazi_agent.venue_price_registry import raw
from moeazi_agent.venue_price_scenarios import evaluate_fixture, scenario_registry

NOW = datetime(2026, 9, 3, tzinfo=timezone.utc)


def test_complete_frozen_corpus_is_local_only_and_deterministic():
    first = [evaluate_fixture(item["id"], "observe", NOW, "operator", "a" * 64) for item in scenario_registry()]
    second = [evaluate_fixture(item["id"], "observe", NOW, "operator", "a" * 64) for item in scenario_registry()]
    assert len(first) >= 50 and all(item["invariantVerdict"] == "pass" for item in first)
    assert [item["receiptHash"] for item in first] == [item["receiptHash"] for item in second]
    assert {item["actualOutcome"] for item in first} == {"pass", "close_only", "block", "unknown"}
    assert all(item["productOutcome"] == "unavailable" and item["feature07Status"] == "requires_revalidation" for item in first)
    assert raw()["prohibited"] == {"externalNetwork": True, "liveExecution": True, "providerRpc": True, "signing": True, "redisReceipts": True}


@pytest.mark.parametrize("case,outcome", [("divergence-above", "block"), ("missing-oracle", "unknown"),
    ("close-lane-proved", "close_only"), ("gmx-cross-short", "pass")])
def test_precedence_and_safe_lanes(case, outcome):
    result = evaluate_fixture(case, "enforce", NOW, "operator", "b" * 64)
    assert result["actualOutcome"] == outcome
    if outcome == "close_only": assert result["safeLanes"] == ["close"]
    else: assert result["safeLanes"] == []


def test_canonical_integers_and_exact_divergence_are_float_free():
    for value in ("01", "1.0", "1e3", True, str(2**256)):
        with pytest.raises(ValueError): integer(value)
    assert ppm("1001", "1000") == 1000 and ppm("1", "0") is None
    with pytest.raises(ValueError): strict_loads('{"a":1,"a":2}')
    with pytest.raises(ValueError): strict_loads('{"a":1.2}')


def test_scope_chain_and_expiry_are_strict():
    from moeazi_agent.venue_price_scenarios import _scope
    assert _scope("gmx-isolated-long").owner_chain_id == 42161
    assert _scope("hyperliquid-isolated-long").owner_chain_id is None
    result = evaluate_fixture("expiry-equality", "observe", NOW, "operator", "c" * 64)
    assert result["actualOutcome"] == "unknown"


def test_migration_declares_full_immutable_scope_qualified_graph():
    sql = (Path(__file__).parents[1] / "migrations" / "024_venue_price_liquidation_safety.sql").read_text().lower()
    for table in ("venue_price_scopes", "venue_price_source_specs", "venue_price_semantics", "venue_price_observations", "venue_price_feature07_bindings", "venue_price_receipts", "venue_price_decisions", "venue_price_request_receipts", "venue_price_test_center_bundles"):
        assert table in sql
    assert "venue_price_reject_mutation" in sql and "agent_test_center_runs" in sql
