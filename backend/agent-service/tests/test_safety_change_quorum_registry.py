from moeazi_agent.safety_change_quorum_registry import raw, registry_hash

def test_registry_is_closed_and_uses_constitutional_floor():
    value=raw()
    assert value["limits"]["quorum"] == 2 and value["limits"]["chainId"] == 42161
    assert "runtime.manual_guard.enabled" in value["paths"] and len(registry_hash()) == 64
