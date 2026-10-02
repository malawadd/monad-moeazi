import pytest
from moeazi_agent.risk_tiered_consent_source_contracts import Feature19ContextBinding
H="a"*64
def test_feature19_binding_is_untrusted_and_requires_revalidation():
    value=Feature19ContextBinding(run_id="run-"+"b"*32,operator_test_id="operator_"+"c"*32,decision_hash=H,registry_hash=H,control_hash=H,request_hash=H)
    assert value.status=="requires_revalidation" and value.authority_effect=="none"
    with pytest.raises(Exception): Feature19ContextBinding(run_id="foreign",operator_test_id="operator_"+"c"*32,decision_hash=H,registry_hash=H,control_hash=H,request_hash=H)
