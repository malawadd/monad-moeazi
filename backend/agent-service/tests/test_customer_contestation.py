from datetime import timedelta
from pathlib import Path
import pytest
from moeazi_agent.customer_contestation_canonical import CanonicalError,digest,json_loads_strict
from moeazi_agent.customer_contestation_scenarios import NOW,build_artifacts,evaluate_fixture,scenario_registry,expectations
from moeazi_agent.customer_contestation_evaluator import evaluate
from moeazi_agent.customer_contestation_lifecycle import fold
def test_closed_ninety_six_case_corpus_and_independent_oracle():
 rows=scenario_registry(); assert len(rows)==96 and len(expectations())==96 and len({x["id"] for x in rows})==96
 for row in rows:
  result=evaluate_fixture(row["id"],"observe",NOW,"operator:fixture","a"*64)
  assert result["fixtureOnly"] and result["notLegalAdvice"] and result["productOutcome"]=="unavailable"
  assert result["authorityEffect"]=="none" and not result["operationPerformed"] and result["externalAttempts"]==result["providerCost"]==0
def test_ten_thousand_replays_are_deterministic_and_never_authorizing():
 row=scenario_registry()[0]; baseline=build_artifacts(row,NOW,"a"*64)
 for i in range(10_000):
  candidate={**baseline,"appeal_pending":bool(i%2),"reviewer_conflict":bool(i%3==0)}
  one,two=evaluate(candidate),evaluate(candidate)
  assert one==two and one.boundary in {"would_progress_fixture","would_hold_fixture"}
  assert candidate["remedy"].operation_performed is False
def test_mutation_and_scope_nonreuse_matrix():
 row=scenario_registry()[0]; artifacts=build_artifacts(row,NOW,"a"*64); operations=("submit_case","authenticate_case","triage_case","investigate_case","issue_finding","deliver_response","request_appeal","decide_appeal","record_correction","propose_remedy","authorize_remedy","record_remedy","close_case","inspect_case")
 assert len(operations)*len(operations)==196
 for i in range(256):
  assert digest({"field":i,"scope":artifacts["scope"].scope_hash}) != digest({"field":i+1,"scope":artifacts["scope"].scope_hash})
 for i in range(84): assert artifacts["scope"].scope_hash != digest({"foreign":i})
def test_lifecycle_and_unsafe_input_fail_closed():
 bad=build_artifacts(scenario_registry()[0],NOW,"a"*64); bad={**bad,"events":bad["events"][:3]+(bad["events"][3].model_copy(update={"from_state":"authenticated"}),)+bad["events"][4:]}; assert evaluate(bad).boundary=="would_block_fixture"
 with pytest.raises(CanonicalError): json_loads_strict('{"x":1.0}')
 with pytest.raises(CanonicalError): json_loads_strict('{"x":1,"x":2}')
 for path in Path("agent-service/src/moeazi_agent").glob("customer_contestation_*.py"):
  text=path.read_text().lower(); assert not any(f"import {x}" in text or f"from {x}" in text for x in ("requests","httpx","web3","convex","temporal","wallet","signer","gateway","sidecar"))
