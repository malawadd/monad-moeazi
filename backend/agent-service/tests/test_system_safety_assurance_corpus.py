from datetime import datetime,timezone
import pytest
from moeazi_agent.safety_assurance_canonical import digest
from moeazi_agent.safety_assurance_evaluator import evaluate
from moeazi_agent.safety_assurance_registry import PACKS,corpus,registry_hash,source_root
NOW=datetime(2026,9,1,tzinfo=timezone.utc); OP="operator-fixture"; REQUEST="a"*64
def test_closed_corpus_has_claims_cases_mutations_and_goldens():
 data=corpus(); assert len(data["claims"])==8 and len(data["cases"])==40 and len(data["mutations"])==96
 assert len(PACKS)==5 and registry_hash()!=source_root()
def test_all_packs_are_deterministic_in_both_isolated_modes():
 for pack in PACKS:
  first=evaluate(pack,"observe",NOW,OP,REQUEST); second=evaluate(pack,"enforce",NOW,OP,REQUEST)
  assert first["status"]==second["status"]=="supported"; assert first["qualificationOutcome"]=="blocked" and second["qualificationOutcome"]=="supported"
  assert first["mutationCount"]==96 and first["killRateBps"]==10000 and first["criticalSurvivorCount"]==0
  assert first["externalAttempts"]==first["providerCost"]==first["signerAttempts"]==0
def test_unknown_pack_is_rejected_and_canonical_is_strict():
 with pytest.raises(ValueError): evaluate("caller-pack","observe",NOW,OP,REQUEST)
 assert digest({"a":1,"b":[True]})==digest({"b":[True],"a":1})
 with pytest.raises(ValueError): digest({"a":1.0})
 with pytest.raises(ValueError): digest({"secret":"x"})
def test_mutation_graph_does_not_allow_critical_survivor():
 graph=evaluate(PACKS[0],"enforce",NOW,OP,REQUEST)["_artifacts"]
 graph["mutations"][0]["killed"]=False
 from moeazi_agent.safety_assurance_graph import verify
 with pytest.raises(ValueError,match="critical_survivor"): verify(graph)
