from datetime import datetime, timezone
from importlib.resources import files
import json
import pytest
from moeazi_agent.mandate_policy_canonical import CanonicalError, json_loads_strict
from moeazi_agent.mandate_policy_diff import semantic_diff
from moeazi_agent.mandate_policy_registry import POLICY_FIELDS, PROFILE_FIELDS, SCOPE_FIELDS, raw
from moeazi_agent.mandate_policy_scenarios import evaluate_fixture, scenario_registry
from moeazi_agent.mandate_policy_storage import MandatePolicyRepository

NOW=datetime(2026,1,1,tzinfo=timezone.utc)
def fixture(name, mode="enforce"): return evaluate_fixture(name,mode,NOW,"operator","a"*64)
def test_registry_is_closed_and_self_hashed():
    assert set(raw()["fields"]) == set(POLICY_FIELDS+PROFILE_FIELDS+SCOPE_FIELDS)
def test_canonical_rejects_duplicate_and_float():
    with pytest.raises(CanonicalError): json_loads_strict('{"x":1,"x":2}')
    with pytest.raises(CanonicalError): json_loads_strict('{"x":1.2}')
def test_fixture_corpus_never_authorizes_product_or_network():
    for item in scenario_registry():
        result=fixture(item["id"])
        assert result["productOutcome"] == "unavailable" and result["authorityEffect"] == "none"
        assert result["externalAttempts"] == result["providerCost"] == 0
def test_diff_keeps_mixed_and_initial_material():
    assert semantic_diff(None,{"maxOrderUsd":1})["aggregate"] == "contains_loosening"
    assert semantic_diff({"maxOrderUsd":1,"minConfidence":2},{"maxOrderUsd":2,"minConfidence":3})["aggregate"] == "mixed"
def test_expired_replayed_and_no_change_cannot_activate():
    for name in ("mpf-expired-challenge","mpf-replayed-consent","mpf-no-change"):
        assert fixture(name)["actualOutcome"] == "blocked"
def test_storage_retry_conflict_and_chain_fold():
    repo=MandatePolicyRepository(); bundle={"activation":{"activationHash":"a"*64,"predecessorHash":None,"result":"simulated_activated","sequence":1}}
    assert repo.persist_bundle("op","s"*64,"key","r"*64,bundle)==repo.persist_bundle("op","s"*64,"key","r"*64,bundle)
    with pytest.raises(RuntimeError): repo.persist_bundle("op","s"*64,"key","q"*64,bundle)
def test_checked_in_expectations_are_an_independent_complete_oracle():
    expected=json.loads(files("moeazi_agent").joinpath("mandate_policy_expectations.json").read_text())
    assert set(expected)=={row["id"] for row in scenario_registry()} and len(expected)==47
    for row in scenario_registry():
        result=fixture(row["id"]); oracle=expected[row["id"]]
        assert (result["actualOutcome"],result["aggregateDiff"],result["reasonCodes"][0]) == (oracle["outcome"],oracle["aggregate"],oracle["reason"])
