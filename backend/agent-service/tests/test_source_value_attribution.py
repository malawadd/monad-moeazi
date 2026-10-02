from datetime import datetime,timezone
from moeazi_agent.source_value_attribution import estimate
from moeazi_agent.source_value_canonical import digest,load
from moeazi_agent.source_value_registry import mutations,registry_hash,scenarios
from moeazi_agent.source_value_scenarios import evaluate_fixture
def run(number,mode="observe"):
 return evaluate_fixture(f"source-value-{number:02d}",mode,datetime(2026,2,1,tzinfo=timezone.utc),"operator",digest({"run":number}),{"contextHash":"a"*64})
def test_closed_corpus_and_canonical_rejections():
 assert len(scenarios())==64 and len(mutations())==128 and len(registry_hash())==64
 try: load('{"x":1,"x":2}')
 except ValueError as exc: assert "duplicate" in str(exc)
 else: raise AssertionError("duplicate JSON key accepted")
def test_citation_sets_stay_distinct_and_no_attempts_exist():
 for number in range(1,65):
  value=run(number); assert value["fixtureOnly"] and value["productOutcome"]=="unavailable"
  assert value["actualProviderCalls"]==value["externalAttempts"]==value["signerAttempts"]==value["walletAttempts"]==value["venueAttempts"]==0
  assert value["supportingEvidenceCount"]<=value["citedEvidenceCount"]<=value["suppliedEvidenceCount"]+1
def test_both_modes_are_deterministic_and_sparse_is_inconclusive():
 for number in range(1,65):
  assert run(number)["rootHash"]==run(number)["rootHash"]
  assert run(number,"enforce")["candidateDecision"] in {"retain","shadow_candidate","inconclusive"}
 assert estimate("primary_curated_news",tuple((1,0) for _ in range(99))).state=="inconclusive"
