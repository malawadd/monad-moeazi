from datetime import datetime, timezone
import pytest
from moeazi_agent.incident_communication_canonical import json_loads_strict
from moeazi_agent.incident_communication_evaluator import policy
from moeazi_agent.incident_communication_registry import raw, registry_hash

def test_registry_and_policy_are_closed_and_canonical():
    assert raw()["channels"] == ["in_app"] and len(registry_hash()) == 64
    assert policy().channel == "in_app" and policy().policy_hash
    with pytest.raises(ValueError, match="duplicate"): json_loads_strict('{"a":1,"a":2}')

def test_policy_rejects_external_channel_mutation():
    body=policy().model_dump(); body["channel"]="email"
    with pytest.raises(Exception): policy().__class__(**body)
