from datetime import datetime,timezone
import pytest
from moeazi_agent.evidence_event_scenarios import scenario_registry,evaluate_fixture
from moeazi_agent.evidence_event_evaluator import evaluate
NOW=datetime(2026,9,1,tzinfo=timezone.utc); OP="operator:fixture"; REQUEST="a"*64
def test_closed_corpus_is_independent_and_dual_mode():
 rows=scenario_registry(); assert len(rows)==len({x["id"] for x in rows})==160
 for row in rows:
  for mode in ("observe","enforce"):
   result=evaluate_fixture(row["id"],mode,NOW,OP,REQUEST); assert result["invariantVerdict"]=="pass" and result["externalAttempts"]==result["providerCost"]==0
def test_same_revision_byte_conflict_is_rejected():
 row={"timeline":[{"source":"market-data","sourceEventId":"same","eventAt":"2026-09-01T00:00:00Z","observedAt":"2026-09-01T00:00:00Z","receivedAt":"2026-09-01T00:00:00Z","body":{"value":1}},{"source":"market-data","sourceEventId":"same","eventAt":"2026-09-01T00:00:00Z","observedAt":"2026-09-01T00:00:00Z","receivedAt":"2026-09-01T00:00:00Z","body":{"value":2}}]}
 with pytest.raises(ValueError,match="same_revision_conflict"): evaluate(row,"observe",NOW,OP,REQUEST)
def test_correction_requires_exact_predecessor_and_no_effects():
 row={"timeline":[{"source":"market-data","sourceEventId":"same","eventAt":"2026-09-01T00:00:00Z","observedAt":"2026-09-01T00:00:00Z","receivedAt":"2026-09-01T00:00:00Z","body":{"value":1}},{"source":"market-data","sourceEventId":"same","revision":2,"supersedesHash":"b"*64,"eventAt":"2026-09-01T00:00:00Z","observedAt":"2026-09-01T00:00:00Z","receivedAt":"2026-09-01T00:00:00Z","body":{"value":2}}]}
 with pytest.raises(ValueError,match="correction_invalid"): evaluate(row,"enforce",NOW,OP,REQUEST)
def test_named_mutation_corpus_exercises_contract_rejection():
 families=("unknown-source","unknown-class","long-id","unknown-body")
 for number in range(320):
  row={"operation":"inspect","timeline":[{"source":"market-data","sourceEventId":"safe","eventAt":"2026-09-01T00:00:00Z","observedAt":"2026-09-01T00:00:00Z","receivedAt":"2026-09-01T00:00:00Z","body":{"value":1}}]}; item=row["timeline"][0]
  kind=families[number%len(families)]
  if kind=="unknown-source": item["source"]="foreign"
  elif kind=="unknown-class": item["eventClass"]="foreign"
  elif kind=="long-id": item["sourceEventId"]="x"*49
  else: item["body"]={"unregistered":number}
  with pytest.raises(ValueError): evaluate(row,"observe",NOW,OP,REQUEST)
def test_fixed_chronological_window_has_no_missed_high_priority_fixture_event():
 from moeazi_agent.evidence_event_chronological import run_chronological_simulation
 value=run_chronological_simulation()
 assert value["inputCount"]==6400 and value["baselineCadenceOpportunities"]==5760 and value["materialRiskCorrectionEvents"]==640
 assert value["missedMaterialEvents"]==value["maximumSnapshotAgeSeconds"]==value["workflowStarted"]==value["providerCost"]==0
def test_operation_and_scope_reuse_attempts_are_rejected():
 from moeazi_agent.evidence_event_graph import validate_graph
 from moeazi_agent.evidence_event_scope_contracts import SelectedFeature03Context
 base={"operation":"inspect","timeline":[{"source":"market-data","sourceEventId":"safe","eventAt":"2026-09-01T00:00:00Z","observedAt":"2026-09-01T00:00:00Z","receivedAt":"2026-09-01T00:00:00Z","body":{"value":1}}]}; graph=evaluate(base,"observe",NOW,OP,REQUEST)
 operations=("freeze_fixture","admit_event","assess_quality","advance_watermark","decide_freshness","decide_materiality","record_trigger_intent","build_replay_manifest","replay")
 for operation in operations:
  for other in operations:
   if operation==other: continue
   changed={**graph,"operation":operation,"operationHash":graph["operationHash"] if other!="inspect" else "b"*64}
   with pytest.raises(ValueError,match="operation_reuse"): validate_graph(changed)
 for number in range(128):
  context=SelectedFeature03Context("run-"+"a"*32,OP,"b"*64)
  with pytest.raises(ValueError,match="context_scope"): evaluate(base,"observe",NOW,OP,f"{number:064x}",context)
