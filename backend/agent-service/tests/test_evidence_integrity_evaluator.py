from moeazi_agent.evidence_integrity_registry import scenarios,mutations,registry_hash
from moeazi_agent.evidence_integrity_scenarios import evaluate_fixture
def run(number,mode="observe"):
 return evaluate_fixture(f"evidence-integrity-{number:02d}",mode,None,"operator","a"*64,{"contextHash":"b"*64})
def test_closed_corpus_and_zero_attempts():
 assert len(scenarios())==72 and len(mutations())==128 and len(registry_hash())==64
 for number in range(1,73):
  value=run(number); assert value["fixtureOnly"] and value["productOutcome"]=="unavailable"
  assert value["providerAttempts"]==value["externalAttempts"]==value["signerAttempts"]==value["walletAttempts"]==value["venueAttempts"]==0
def test_clustering_and_quarantine_never_increase_authority():
 for number in range(1,73):
  value=run(number,"enforce")
  assert value["independentClusters"]<=value["unsafeBaselineClusters"]
  assert value["decision"] in {"allow","degrade","block"}
 assert run(4)["quarantinedCount"]==1
