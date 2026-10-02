from datetime import datetime, timezone
import pytest
from moeazi_agent.mandate_policy_scenarios import _mandate
from moeazi_agent.mandate_policy_compiler import compile_mandate
from moeazi_agent.mandate_policy_diff import semantic_diff
from moeazi_agent.mandate_policy_evaluator import MandatePolicyState, issue_challenge, consume_and_activate
from moeazi_agent.mandate_policy_canonical import digest
def test_observe_never_consumes_and_replay_blocks():
    now=datetime(2026,1,1,tzinfo=timezone.utc); compiled=compile_mandate(_mandate(now,30000000)); diff=semantic_diff(None,{**compiled.policy,**compiled.binding}); state=MandatePolicyState(); challenge=issue_challenge(_mandate(now).scope.scope_hash,compiled,diff,None,now,digest({"idempotency":"x"}))
    assert consume_and_activate(state,challenge,compiled,diff,now,"observe","x",_mandate(now).scope.scope_hash)["currentHead"] is None
    consume_and_activate(state,challenge,compiled,diff,now,"enforce","x",_mandate(now).scope.scope_hash)
    with pytest.raises(ValueError): consume_and_activate(state,challenge,compiled,diff,now,"enforce","x",_mandate(now).scope.scope_hash)
def test_request_identity_and_idempotency_rebinding_are_exact():
    now=datetime(2026,1,1,tzinfo=timezone.utc); compiled=compile_mandate(_mandate(now,30000000)); diff=semantic_diff(None,{**compiled.policy,**compiled.binding}); state=MandatePolicyState(); request=digest({"request":"one"}); identity={"tenant":"tenant:fixture","user":"user:fixture","account":"account:fixture","confirmer":"user:fixture"}; challenge=issue_challenge(_mandate(now).scope.scope_hash,compiled,diff,None,now,digest({"idempotency":"x"}),identity,request)
    with pytest.raises(ValueError): consume_and_activate(state,challenge,compiled,diff,now,"enforce","x",_mandate(now).scope.scope_hash,identity,request_hash=digest({"request":"two"}))
    assert consume_and_activate(state,challenge,compiled,diff,now,"enforce","x",_mandate(now).scope.scope_hash,identity,request_hash=request)["activation"]
