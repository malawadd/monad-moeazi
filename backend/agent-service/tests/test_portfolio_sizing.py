import pytest
from moeazi_agent.portfolio_sizing_canonical import digest,load
from moeazi_agent.portfolio_sizing_evaluator import evaluate
from moeazi_agent.portfolio_sizing_registry import mutations,registry_hash,scenarios
from moeazi_agent.portfolio_sizing_scenarios import evaluate_fixture
CTX={"contextHash":"b"*64,"trustStatus":"requires_revalidation"}
def run(number,mode="observe"): return evaluate_fixture(f"portfolio-sizing-{number:03d}",mode,None,"operator","a"*64,CTX)
def test_closed_corpus_and_mutations_are_deterministic():
 assert len(scenarios())==96 and len(mutations())==256 and registry_hash()==registry_hash()
 assert run(1)==run(1)
def test_hard_failure_abstains_and_never_increases_authority():
 for number in (4,5,9,11,12):
  value=run(number); assert value["decision"]=="abstain" and value["approvedNotional"]==0
  assert value["authorityEffect"]=="none" and value["externalAttempts"]==value["signerAttempts"]==0
def test_degradation_is_monotonic_and_enforce_stays_fixture_only():
 clean=run(1); thin=run(7); enforce=run(1,"enforce")
 assert thin["approvedNotional"]<=clean["approvedNotional"]
 assert enforce["decision"]==clean["decision"] and enforce["fixtureOnly"] is True
def test_canonical_rejects_duplicate_and_float_json():
 with pytest.raises(ValueError): load('{"a":1,"a":2}')
 with pytest.raises(ValueError): load('{"a":1.2}')
 assert digest({"a":1})==digest({"a":1})
def test_invalid_context_is_fail_closed():
 value=evaluate("portfolio-sizing-001","observe","operator","a"*64,{})
 assert value["decision"]=="abstain" and "FEATURE09_BINDING_INVALID" in value["bindingConstraints"]
