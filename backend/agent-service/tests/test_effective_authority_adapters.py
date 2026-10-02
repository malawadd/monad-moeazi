from moeazi_agent.effective_authority_owner_adapters_control import consume_control_gate
from moeazi_agent.effective_authority_owner_adapters_execution import consume_execution_gate
from moeazi_agent.effective_authority_owner_adapters_governance import consume_governance_gate

H="a"*64

def test_distinct_owner_adapters_reject_scope_version_and_provenance_mismatches():
    control={"gateId":"deployment","sourceType":"deployment","sourceVersion":"fixture-v1","scopeHash":H,"receiptHash":H,"status":"pass","safeCode":"SAFE"}
    execution={"receiptType":"risk","receiptVersion":"fixture-v1","scopeHash":H,"receiptHash":H,"status":"pass","safeCode":"SAFE"}
    governance={"receiptType":"policy","receiptVersion":"fixture-v1","scopeHash":H,"receiptHash":H,"status":"pass","safeCode":"SAFE","provenance":"local_fixture_untrusted"}
    assert consume_control_gate(control,"deployment",H)==("pass","SAFE")
    assert consume_execution_gate(execution,"risk",H)==("pass","SAFE")
    assert consume_governance_gate(governance,"policy",H)==("pass","SAFE")
    assert consume_control_gate({**control,"scopeHash":"b"*64},"deployment",H)[0]=="unknown"
    assert consume_execution_gate({**execution,"receiptVersion":"fixture-v0"},"risk",H)[0]=="unknown"
    assert consume_governance_gate({**governance,"provenance":"authoritative_product"},"policy",H)[0]=="unknown"
