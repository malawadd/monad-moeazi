import pytest
from moeazi_agent.execution_quality_canonical import digest,load
from moeazi_agent.execution_quality_evaluator import evaluate
from moeazi_agent.execution_quality_registry import mutations,registry_hash,scenarios
from moeazi_agent.execution_quality_scenarios import evaluate_fixture
CTX={"contextHash":"b"*64,"trustStatus":"requires_revalidation","decision":"approve_for_routing","quantity":250,"notional":25_000}
def run(number,mode="observe"): return evaluate_fixture(f"execution-quality-{number:03d}",mode,None,"operator","a"*64,CTX)
def test_closed_corpus_and_mutations_are_deterministic():
 assert len(scenarios())==96 and len(mutations())==256 and registry_hash()==registry_hash() and run(1)==run(1)
def test_stale_gap_and_unknown_paths_abstain_without_attempts():
 for number in (2,3,10,12):
  value=run(number); assert value["decision"]=="abstain_no_synthetic_route" or value["eligibleCount"]<value["candidateCount"]
  assert value["authorityEffect"]=="none" and value["externalAttempts"]==value["signerAttempts"]==value["venueAttempts"]==0
def test_worsening_never_increases_eligibility_and_enforce_is_fixture_only():
 assert run(8)["eligibleCount"]<=run(1)["eligibleCount"]
 assert run(1,"enforce")["fixtureOnly"] is True
def test_uncertainty_latches_and_never_fails_over():
 value=run(10); assert value["uncertaintyLatch"] is True and value["selectedVenue"] is None
def test_canonical_rejects_duplicate_and_float_json_and_invalid_context_fails_closed():
 with pytest.raises(ValueError): load('{"a":1,"a":2}')
 with pytest.raises(ValueError): load('{"a":1.2}')
 assert digest({"a":1})==digest({"a":1})
 assert evaluate("execution-quality-001","observe","operator","a"*64,{})["decision"]=="abstain_no_synthetic_route"
