import json
from importlib.resources import files
from moeazi_agent.operator_qualification_canonical import digest
from moeazi_agent.operator_qualification_registry import raw, registry_hash

def test_registry_self_hash_and_closed_inventory():
    value=raw(); assert registry_hash()==value["selfHash"]==digest({k:v for k,v in value.items() if k!="selfHash"})
    assert set(value["drills"])=={"alert-storm","emergency-stop","handoff","incident-communication","revocation","uncertain-submission","unsafe-pressure"}
    assert set(value["roles"])=={"incident_commander","incident_communications_operator","recovery_operator","safety_change_approver","strategy_termination_operator"}
    assert value["accommodation"]["presentationOnly"] is True and value["accommodation"]["equivalentOracleHash"]=="fixture-equivalent"
    assert all(isinstance(spec["deadline"],int) and spec["hard"] for spec in value["drills"].values())
    assert all(isinstance(role,str) for operations in value["consumers"].values() for role in operations.values())

def test_registry_has_only_synthetic_fake_capabilities():
    text=files("moeazi_agent").joinpath("operator_qualification_registry.json").read_text("utf8")
    assert json.loads(text)==raw()
    assert set(raw()["fakeAdapters"])=={"fake_clock","fake_inbox","fake_provider","fake_signer","fake_venue"}
    assert not any(token in text.lower() for token in ("http://","https://","private_key","credential","wallet"))
