import pytest
from moeazi_agent.analytical_diversity_canonical import load
from moeazi_agent.analytical_diversity_evaluator import REQUIRED,evaluate
from moeazi_agent.analytical_diversity_oracle import expected
from moeazi_agent.analytical_diversity_registry import mutations,scenarios
def bindings(): return {name:{"trustStatus":"requires_revalidation","zeroAttempts":True,"notAuthorizing":True} for name in REQUIRED}
def test_all_fixture_cases_are_deterministic_and_inert():
 assert len(scenarios())==96 and len(mutations())==256
 for row in scenarios():
  result=evaluate(row["id"],"enforce","operator","a"*64,bindings())
  assert result["effectiveVerdict"]==expected(row["id"],"enforce")
  assert all(result[key]==0 for key in ("providerAttempts","externalAttempts","networkAttempts","workflowAttempts","signerAttempts","walletAttempts","venueAttempts","executionAttempts","creditAttempts","providerCost"))
def test_observe_caps_supported_and_strict_parser_rejects_unsafe_input():
 assert evaluate("analytical-diversity-001","observe","operator","b"*64,bindings())["effectiveVerdict"]=="exploratory"
 assert evaluate("analytical-diversity-001","enforce","operator","c"*64,None)["effectiveVerdict"]=="blocked"
 with pytest.raises(ValueError): load('{"a":1,"a":2}')
 with pytest.raises(ValueError): load('{"a":1.5}')
