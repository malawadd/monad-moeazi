from moeazi_agent.effective_authority_scenarios import NOW, evaluate_fixture, scenario_registry
import json
from importlib.resources import files
def test_checked_in_scenarios_are_sanitized_and_closed():
    for row in scenario_registry():
        result=evaluate_fixture(row["id"],"enforce",NOW,"operator:test","a"*64)
        assert result["invariantVerdict"] == "pass" and result["externalAttempts"] == result["providerCost"] == 0
        assert result["productOutcome"] == "unavailable" and "receipt" not in result
def test_every_scenario_has_an_independent_expectation():
    expected=json.loads(files("moeazi_agent").joinpath("effective_authority_expectations.json").read_text())
    assert {item["id"] for item in scenario_registry()} == set(expected)

def test_test_center_registry_assigns_the_closed_fixture_operation():
    from moeazi_agent.test_center_fixtures import registry_response
    rows=[item for item in registry_response()["scenarios"] if item["featureId"]=="effective-authority-decision"]
    assert len(rows)==26 and {item["operation"] for item in rows}=={"effective_authority_projection"}

def test_declared_mutations_are_observed_and_named_failures_are_not_all_pass():
    baseline=evaluate_fixture("authority-local-all-pass","enforce",NOW,"operator:test","a"*64)
    for row in scenario_registry():
        result=evaluate_fixture(row["id"],"enforce",NOW,"operator:test","a"*64)
        declared=any((row["removeGate"],row["mutateGate"],row["clockDeltaSeconds"],row["chainFault"],row["wrongScope"],row["wrongSourceVersion"],row["unknownGate"]))
        if declared:
            assert result["mutationObserved"] != "none"
            observed=set(result["mutationObserved"].split("|"))
            if row["removeGate"]: assert f"remove:{row['removeGate']}" in observed
            if row["mutateGate"]: assert f"status:{row['mutateGate']}:{row['mutateStatus']}" in observed
            if row["clockDeltaSeconds"]: assert f"clock:+{row['clockDeltaSeconds']}s" in observed
            if row["chainFault"]: assert f"chain:{row['chainFault']}:{row['mutateGate']}" in observed
            if row["wrongScope"]: assert f"scope:{row['mutateGate']}" in observed
            if row["wrongSourceVersion"]: assert f"source-version:{row['mutateGate']}" in observed
            if row["unknownGate"]: assert "unknown-gate:unknown_gate" in observed
            assert (result["effectiveCapability"],result["phase"],result["coverage"],result["reasonCodes"]) != (baseline["effectiveCapability"],baseline["phase"],baseline["coverage"],baseline["reasonCodes"])
