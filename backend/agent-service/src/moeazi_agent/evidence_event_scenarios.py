"""Independent checked-in scenario inputs and expectation oracle."""
from __future__ import annotations
import json
from functools import lru_cache
from importlib.resources import files
from .evidence_event_canonical import digest
from .evidence_event_evaluator import evaluate
from .evidence_event_projection import safe_projection
def _pairs(rows):
    out={}
    for key,value in rows:
        if key in out: raise ValueError("evidence_scenario_duplicate_key")
        out[key]=value
    return out
def _load(name): return json.loads(files("moeazi_agent").joinpath(name).read_text("utf8"),object_pairs_hook=_pairs)
@lru_cache(maxsize=1)
def scenario_registry():
    rows=[]
    for part in range(1,11):
        data=_load(f"evidence_event_scenarios_{part:02d}.json")
        if data.get("part")!=part or len(data.get("scenarios",()))!=16: raise ValueError("evidence_scenario_part_invalid")
        rows.extend(data["scenarios"])
    ids=[x.get("id") for x in rows]
    if len(rows)!=160 or len(set(ids))!=160 or len({digest({k:v for k,v in x.items() if k!="id"}) for x in rows})!=160: raise ValueError("evidence_scenario_closure_invalid")
    return tuple(rows)
@lru_cache(maxsize=1)
def expectations():
    result={}
    for part in range(1,11):
        data=_load(f"evidence_event_expectations_{part:02d}.json")
        if data.get("part")!=part or len(data.get("ids",()))!=16 or set(data.get("ids",()))!=set(data.get("expected",{})): raise ValueError("evidence_expectation_part_invalid")
        if set(result)&set(data["expected"]): raise ValueError("evidence_expectation_duplicate")
        result.update(data["expected"])
    if set(result)!={x["id"] for x in scenario_registry()}: raise ValueError("evidence_expectation_closure_invalid")
    return result
def evaluate_fixture(scenario_id,mode,now,operator,run_hash,context=None,controls=None):
    row=next((x for x in scenario_registry() if x["id"]==scenario_id),None)
    if not row: raise ValueError("evidence_unknown_scenario")
    graph=evaluate(row,mode,now,operator,run_hash,context,controls); result={"scenarioId":scenario_id,"fixtureHash":digest(row),"registryHash":graph["manifest"]["registryHash"],"invariantVerdict":"pass","_artifacts":graph}; result.update(safe_projection(graph))
    for key,value in expectations()[scenario_id].items():
        if result.get(key)!=value: raise AssertionError(f"evidence_expectation_failed:{scenario_id}:{key}")
    return result
