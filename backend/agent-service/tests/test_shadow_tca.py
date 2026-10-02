from moeazi_agent.shadow_tca_canonical import digest,load
from moeazi_agent.shadow_tca_contracts import ShadowTcaScope,Feature32ShadowBinding,MarketStateSnapshot,ShadowExecutionRequest
from moeazi_agent.shadow_tca_evaluator import evaluate
from moeazi_agent.shadow_tca_registry import mutations,registry_hash,scenarios
from moeazi_agent.shadow_tca_scenarios import evaluate_fixture
CTX={"trustStatus":"requires_revalidation","decision":"hypothetical_route","zeroAttempts":True,"contextHash":"fixture"}
def run(number,mode="observe"): return evaluate_fixture(f"shadow-tca-{number:03d}",mode,None,"operator","a"*64,CTX)
def test_registry_and_corpus_are_bounded_and_mutation_complete():
 assert len(scenarios())>=10 and len(mutations())>=256 and len(registry_hash())==64
def test_canonical_rejects_floats_and_duplicate_keys():
 for raw in ('{"x":1.2}','{"x":1,"x":2}'):
  try: load(raw); assert False
  except ValueError: pass
 assert digest({"b":2,"a":1})==digest({"a":1,"b":2})
def test_strict_contracts_bind_chain_and_causality():
 scope=ShadowTcaScope("tenant","account","ETH-USD","fixture")
 binding=Feature32ShadowBinding("run-a","a"*64,"b"*64,"c"*64,"d"*64,"e"*64,"2026-01-01T00:00:00Z","hypothetical_route")
 snap=MarketStateSnapshot("clob_perpetual","2026-01-01T00:00:00Z","2026-01-01T00:00:30Z",1,100,101,10,1,0,0,"sequence_complete_replay")
 request=ShadowExecutionRequest(scope,binding,"buy",10,"limit","IOC",101,"2026-01-01T00:00:00Z","2026-01-01T00:00:01Z","2026-01-01T00:00:02Z","fixture-key")
 assert snap.snapshot_hash and request.request_hash and scope.scope_hash
def test_clob_and_amm_are_separate_and_conserve_quantity():
 clob,amm=run(1),run(5)
 assert clob["semanticFamily"]=="clob_perpetual" and amm["semanticFamily"]=="arbitrum_amm"
 for value in (clob,amm): assert value["filledQuantity"]+value["residualQuantity"]==1000
def test_abstention_never_fabricates_unknown_cost_or_fill():
 for number in (4,8,9,10):
  value=run(number); assert value["terminalState"] in {"unknown","cancelled"}; assert value["calibrationDecision"]=="insufficient"
def test_retry_is_deterministic_and_invalid_feature32_binding_fails_closed():
 first=run(1); second=run(1); assert first["rootHash"]==second["rootHash"]
 value=evaluate("shadow-tca-001","observe","operator","a"*64,{})
 assert value["filledQuantity"]==0 and "FEATURE32_BINDING_INVALID" in value["reasonCodes"]
def test_all_results_are_local_non_authorizing_and_synthetic_only():
 for index in range(1,11):
  value=run(index); assert value["fixtureOnly"] and value["productOutcome"]=="unavailable" and value["authorityEffect"]=="none"
  assert all(value[key]==0 for key in ("providerAttempts","externalAttempts","signerAttempts","walletAttempts","venueAttempts"))
