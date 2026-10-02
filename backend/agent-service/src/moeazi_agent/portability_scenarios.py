"""Closed 112-case oracle.  Expectations are separately checked-in fixture data."""
from __future__ import annotations
import json
from functools import lru_cache
from importlib.resources import files
from .portability_canonical import digest
from .portability_evaluator import evaluate
from .portability_projection import safe_projection
def _pairs(items):
 out={}
 for k,v in items:
  if k in out: raise ValueError("portability_duplicate_json_key")
  out[k]=v
 return out
def _load(name): return json.loads(files("moeazi_agent").joinpath(name).read_text("utf8"),object_pairs_hook=_pairs)
@lru_cache(maxsize=1)
def scenario_registry():
 rows=[]
 for part in range(1,8):
  data=_load(f"portability_scenarios_{part:02d}.json")
  if data.get("part")!=part or len(data.get("scenarios",[]))!=16: raise ValueError("portability_scenario_part_invalid")
  rows.extend(data["scenarios"])
 ids=[x.get("id") for x in rows]
 normalized=[{k:v for k,v in x.items() if k!="id"} for x in rows]
 if len(rows)!=112 or len(set(ids))!=112 or len({digest(x) for x in normalized})!=112: raise ValueError("portability_scenario_closure_invalid")
 return tuple(rows)
@lru_cache(maxsize=1)
def expectations():
 rows=[]
 for part in range(1,8):
  data=_load(f"portability_expectations_{part:02d}.json")
  if data.get("part")!=part or len(data.get("ids",[]))!=16 or not isinstance(data.get("expected"),dict): raise ValueError("portability_expectation_part_invalid")
  rows.extend({"id":item,"expected":data["expected"]} for item in data["ids"])
 result={x["id"]:x["expected"] for x in rows}
 if len(result)!=112 or set(result)!={x["id"] for x in scenario_registry()}: raise ValueError("portability_expectation_closure_invalid")
 return result
def evaluate_fixture(scenario_id,mode,now,operator,run_hash):
 row=next((x for x in scenario_registry() if x["id"]==scenario_id),None)
 if not row: raise ValueError("portability_unknown_scenario")
 graph=evaluate({**row,"operator":operator,"runHash":run_hash},mode,now); result={"scenarioId":scenario_id,"fixtureHash":digest({"scenario":row,"run":run_hash}),"registryHash":graph["manifest"].registry_hash,"invariantVerdict":"pass","_artifacts":graph}; result.update(safe_projection(graph))
 for key,value in expectations()[scenario_id].items():
  if result.get(key)!=value: raise AssertionError(f"portability_expectation_failed:{scenario_id}:{key}")
 return result
