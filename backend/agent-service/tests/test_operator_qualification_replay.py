import json
from datetime import datetime, timezone
from importlib.resources import files
from moeazi_agent.operator_qualification_canonical import digest
from moeazi_agent.operator_qualification_scenarios import evaluate_fixture, scenario_registry

NOW=datetime(2026,1,1,tzinfo=timezone.utc)
def test_all_checked_in_scenarios_are_deterministic_and_non_authoritative():
    ids=[entry["id"] for entry in scenario_registry()]
    assert len(ids)==26 and len(ids)==len(set(ids))
    for scenario_id in ids:
        one=evaluate_fixture(scenario_id,"observe",NOW,"operator:test","a"*64); two=evaluate_fixture(scenario_id,"observe",NOW,"operator:test","a"*64)
        assert one==two and one["productQualificationStatus"]=="unknown"
        assert one["productOutcome"]=="unavailable" and one["authorityEffect"]=="none"
        assert one["externalAttempts"]==one["providerCost"]==0

def test_expectations_and_input_mutation_sensitivity_are_checked_in():
    expected=json.loads(files("moeazi_agent").joinpath("operator_qualification_expectations.json").read_text())["expected"]
    for scenario_id,outcome in expected.items():
        result=evaluate_fixture(scenario_id,"observe",NOW,"operator:test","a"*64)
        field="actualOutcome" if outcome in {"granted_fixture","incomplete","blocked"} else "fixtureQualificationStatus"
        assert result[field]==outcome
    source=json.loads(files("moeazi_agent").joinpath("operator_qualification_scenarios.json").read_text())["scenarios"][0]
    assert digest(source)!=digest({**source,"kind":"hard_fail"})
