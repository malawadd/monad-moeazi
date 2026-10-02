from datetime import timedelta
from moeazi_agent.effective_authority_scenarios import NOW, _request, _gate
from moeazi_agent.effective_authority_registry import required_gate_ids
from moeazi_agent.effective_authority_reducer import reduce

def _all(request): return tuple(_gate(g,request,n+1) for n,g in enumerate(required_gate_ids()))
def test_local_all_pass_is_never_submission_eligible():
    request=_request(True); decision=reduce(request,_all(request),"Autopilot",NOW)
    assert decision.capability == "PREFLIGHT_ONLY" and decision.phase == "PREFLIGHT_ONLY"
    assert decision.product_status == "unavailable" and decision.non_authorizing
def test_missing_and_stale_reduce():
    request=_request(True); gates=list(_all(request)); gates.pop()
    missing=reduce(request,tuple(gates),"Autopilot",NOW)
    stale_gate=gates[0].model_copy(update={"expires_at":NOW-timedelta(milliseconds=1)})
    stale=reduce(request,tuple([stale_gate,*gates[1:]]),"Autopilot",NOW)
    assert missing.capability == stale.capability == "ANALYZE_ONLY"
    assert any(x.reason_code == "MISSING_REQUIRED_GATE" for x in missing.reasons)
