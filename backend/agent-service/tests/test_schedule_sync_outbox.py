from datetime import datetime,timezone
import pytest
from moeazi_agent.schedule_sync_canonical import digest
from moeazi_agent.schedule_sync_evaluator import evaluate
from moeazi_agent.schedule_sync_graph import verify
from moeazi_agent.schedule_sync_scenarios import scenario_registry,evaluate_fixture
NOW=datetime(2026,9,1,tzinfo=timezone.utc); OP="operator:fixture"; REQUEST="a"*64
def test_closed_dual_mode_corpus_and_no_effects():
 rows=scenario_registry(); assert len(rows)==len({x["id"] for x in rows})==128
 for row in rows:
  for mode in ("observe","enforce"):
   result=evaluate_fixture(row["id"],mode,NOW,OP,REQUEST)
   assert result["invariantVerdict"]=="pass" and result["externalAttempts"]==result["providerCost"]==0
 assert sum(x["nonmaterial"] for x in rows)>=38
def test_nonmaterial_never_creates_a_command():
 row={"operation":"inspect","revision":1,"nonmaterial":True,"markets":[{"marketId":"arb-usdc","cadence":"15m"}]}
 graph=evaluate(row,"enforce",NOW,OP,REQUEST); assert graph["command"] is None and not graph["transitions"]
def test_guard_unknown_and_lite_clamp_remain_non_authorizing():
 row={"operation":"reconcile_fixture","revision":1,"manualGuard":"unknown","markets":[{"marketId":"arb-usdc","cadence":"1m"},{"marketId":"arb-weth","cadence":"1m"}]}
 graph=evaluate(row,"observe",NOW,OP,REQUEST); assert graph["state"].effective_state=="unknown" and graph["actual"].schedule_count==0
def test_invalid_transition_scope_and_operation_reuse_are_rejected():
 row={"operation":"inspect","revision":1,"markets":[{"marketId":"arb-usdc","cadence":"15m"}]}; graph=evaluate(row,"observe",NOW,OP,REQUEST)
 with pytest.raises(ValueError,match="operation_reuse"): verify({**graph,"operation":"replay"})
 with pytest.raises(ValueError): evaluate({**row,"markets":[{"marketId":"not unicode ❌","cadence":"15m"}]},"observe",NOW,OP,REQUEST)
def test_hash_is_stable_and_rejects_float_secretish_input():
 assert digest({"x":1,"y":["a"]})==digest({"y":["a"],"x":1})
 with pytest.raises(ValueError): digest({"amount":1.0})
 with pytest.raises(ValueError): digest({"token":"nope"})
def test_retry_graph_is_idempotent_fake_readback_only():
 row={"operation":"retry","revision":1,"retry":True,"markets":[{"marketId":"arb-usdc","cadence":"15m"}]}; graph=evaluate(row,"enforce",NOW,OP,REQUEST)
 assert [x.status for x in graph["transitions"]]==["dispatching","retry_wait","dispatching","acknowledged"]
 assert graph["mutation"].operation_performed is False
