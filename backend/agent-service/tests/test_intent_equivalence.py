from datetime import datetime, timezone
from pathlib import Path
import pytest

from moeazi_agent.intent_equivalence_canonical import json_loads_strict, strict_hex
from moeazi_agent.intent_equivalence_registry import raw
from moeazi_agent.intent_equivalence_scenarios import evaluate_fixture, scenario_registry

NOW = datetime(2026, 8, 15, tzinfo=timezone.utc)

def test_frozen_corpus_has_exact_parity_and_no_authority():
    results = [evaluate_fixture(item["id"], "observe", NOW, "operator", "a" * 64) for item in scenario_registry()]
    assert len(results) >= 18 and all(item["invariantVerdict"] == "pass" for item in results)
    assert all(item["productOutcome"] == "unavailable" and item["feature10Status"] == "requires_revalidation" for item in results)
    assert raw()["prohibited"] == {"externalNetwork": True, "liveSubmit": True, "signing": True, "providerRpc": True, "redisReceipts": True}

@pytest.mark.parametrize("case,outcome", [("stage-race", "fail"), ("input-plus-one", "fail"), ("minimum-output-minus-one", "fail"), ("expired", "fail"), ("unknown-selector", "unknown"), ("unexplained-delta", "unknown")])
def test_mutation_precedence_is_deterministic(case, outcome):
    result = evaluate_fixture(case, "enforce", NOW, "operator", "b" * 64)
    assert result["actualOutcome"] == outcome

def test_duplicate_json_float_and_hex_ceiling_rejected():
    with pytest.raises(ValueError): json_loads_strict('{"a":1,"a":2}')
    with pytest.raises(ValueError): json_loads_strict('{"a":1.1}')
    with pytest.raises(ValueError): strict_hex("0x" + "00" * 16385)

def test_migration_is_scope_qualified_and_immutable():
    sql = (Path(__file__).parents[1] / "migrations" / "023_intent_execution_equivalence.sql").read_text().lower()
    for table in ("equivalence_reviewed_intents", "equivalence_envelopes", "equivalence_artifacts", "equivalence_decoded_plans", "equivalence_contexts", "equivalence_checks", "equivalence_receipts", "equivalence_request_receipts", "equivalence_test_center_bundles"):
        assert table in sql
    assert "pg_advisory_xact_lock" not in sql and "intent_equivalence_reject_mutation" in sql
