from moeazi_agent.run_planning_canonical import digest,load
from moeazi_agent.run_planning_evaluator import evaluate
from moeazi_agent.run_planning_registry import mutations,obligations,scenarios
from moeazi_agent.run_planning_scenarios import evaluate_fixture
CTX={"trustStatus":"requires_revalidation","zeroAttempts":True,"contextHash":"fixture"}
def run(index): return evaluate_fixture(f"run-planning-{index:03d}","observe",None,"operator","a"*64,CTX)
def test_canonical_rejects_float_and_duplicate_keys():
 for raw in ('{"x":1.2}','{"x":1,"x":2}'):
  try: load(raw); assert False
  except ValueError: pass
 assert digest({"b":2,"a":1})==digest({"a":1,"b":2})
def test_corpus_and_mutations_are_bounded_complete(): assert len(scenarios())>=12 and len(mutations())>=256
def test_precedence_fails_closed_and_quiet_preserves_snapshot():
 assert run(1)["decision"]=="skip" and run(1)["priorSnapshotRetained"] and not run(1)["freshnessExtended"]
 for index in (5,6,7,10,11): assert run(index)["decision"]=="abstain"
def test_material_inputs_retain_complete_registered_tier_plan():
 for index in (3,4,8,9,12):
  value=run(index); assert value["decision"]=="full_run"; assert value["plannedSlotCount"]==len(obligations(value["tier"]))
def test_invalid_context_never_skips_or_dispatches():
 value=evaluate("run-planning-001","observe","operator","a"*64,{})
 assert value["decision"]=="abstain" and "PREDECESSOR_BINDING_INVALID" in value["reasonCodes"]
 assert all(value[key]==0 for key in ("providerAttempts","externalAttempts","signerAttempts","walletAttempts","venueAttempts","workflowAttempts","creditsReserved"))
def test_retry_is_deterministic_and_budget_is_not_partial():
 assert run(3)["rootHash"]==run(3)["rootHash"]
 value=run(10); assert value["maximumCalls"]==0 and value["decision"]=="abstain"
