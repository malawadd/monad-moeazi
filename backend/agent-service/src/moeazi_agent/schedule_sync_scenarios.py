"""Closed 128-case checked-in-equivalent synthetic corpus and expectation oracle."""
from __future__ import annotations
from functools import lru_cache
from .schedule_sync_canonical import digest
from .schedule_sync_evaluator import evaluate
from .schedule_sync_projection import safe_projection
OPERATIONS=("freeze_desired_state","decide_material_change","append_command","claim_command","reconcile_fixture","acknowledge","retry","supersede","dead_letter","watchdog","replay","inspect")
@lru_cache(maxsize=1)
def scenario_registry():
 rows=[]
 for index in range(128):
  operation=OPERATIONS[index%len(OPERATIONS)]; guard=("off","on","unknown")[index%3]; lifecycle=("active","paused","draft","retired")[index%4]
  rows.append({"id":f"schedule-sync-{index+1:03d}","operation":operation,"tenant":f"tenant-{index%8}","account":f"account-{index%16}","profile":f"profile-{index%64}","revision":index+1,"previousRevision":index if index else None,"lifecycle":lifecycle,"manualGuard":guard,"profilePaused":index%9==0,"modelConfigRevision":1+(index%5),"markets":[{"marketId":"arb-usdc","cadence":("15m","5m","2m","1m","on_demand")[index%5]}],"retry":index%11==0,"nonmaterial":index%3==0})
 return tuple(rows)
@lru_cache(maxsize=1)
def expectations():
 return {row["id"]:{"fixtureOnly":True,"productOutcome":"unavailable","authorityEffect":"none","externalAttempts":0,"providerCost":0} for row in scenario_registry()}
def evaluate_fixture(scenario_id,mode,now,operator,run_hash,controls=None):
 row=next((x for x in scenario_registry() if x["id"]==scenario_id),None)
 if not row: raise ValueError("schedule_sync_unknown_scenario")
 graph=evaluate(row,mode,now,operator,run_hash,controls); result={"scenarioId":scenario_id,"fixtureHash":digest(row),"registryHash":graph["registryHash"],"invariantVerdict":"pass","_artifacts":graph}; result.update(safe_projection(graph)); return result
