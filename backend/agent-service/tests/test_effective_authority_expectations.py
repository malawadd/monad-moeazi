import json
from importlib.resources import files
from moeazi_agent.effective_authority_scenarios import NOW, evaluate_fixture
def test_independent_checked_in_expectations():
    data=json.loads(files("moeazi_agent").joinpath("effective_authority_expectations.json").read_text())
    for scenario,expected in data.items():
        result=evaluate_fixture(scenario,"enforce",NOW,"operator:test","a"*64)
        assert {key:result[key] for key in expected} == expected
