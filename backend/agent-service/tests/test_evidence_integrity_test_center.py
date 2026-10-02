from moeazi_agent.evidence_integrity_scenarios import evaluate_fixture
def test_observe_and_enforce_are_deterministic_and_non_authorizing():
 first=evaluate_fixture("evidence-integrity-01","observe",None,"operator","c"*64,{"contextHash":"d"*64})
 second=evaluate_fixture("evidence-integrity-01","enforce",None,"operator","c"*64,{"contextHash":"d"*64})
 assert first["rootHash"]==second["rootHash"] and first["authorityEffect"]=="none"
