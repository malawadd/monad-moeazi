from datetime import datetime, timedelta, timezone
from moeazi_agent.operator_qualification_evaluator import consume, grant_state
from moeazi_agent.operator_qualification_scenarios import evaluate_fixture

NOW=datetime(2026,1,1,tzinfo=timezone.utc)
def items(name="qualification-pass-independent-review"):
    return evaluate_fixture(name,"observe",NOW,"operator:test","a"*64)["_artifacts"]
def test_exact_consumer_role_and_product_never_accepts():
    value=items(); receipt=consume(value["scope"].scope_hash,value["grant"],value["role"],[],"safety-change-quorum","approval",NOW)
    assert receipt.fixture_compatible and receipt.accepted_for_product is False
    wrong=value["role"].model_copy(update={"role":"incident_commander"})
    assert not consume(value["scope"].scope_hash,value["grant"],wrong,[],"safety-change-quorum","approval",NOW).fixture_compatible

def test_expiry_revocation_scope_and_unmapped_operations_block():
    value=items(); grant=value["grant"]
    assert grant_state(grant,[],now=grant.expires_at)=="expired"
    assert not consume(value["scope"].scope_hash,grant,value["role"],[],"safety-change-quorum","wrong:operation",NOW).fixture_compatible
    assert not consume("f"*64,grant,value["role"],[],"safety-change-quorum","approval",NOW).fixture_compatible
    revoked=items("qualification-revoked-consumption")
    assert grant_state(revoked["grant"],revoked["revocations"],now=NOW)=="revoked"
