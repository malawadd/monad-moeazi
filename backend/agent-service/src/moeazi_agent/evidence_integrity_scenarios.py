"""Feature 30 Test Center adapter with checked-in scenario IDs only."""
from __future__ import annotations
from .evidence_integrity_canonical import digest
from .evidence_integrity_evaluator import evaluate
from .evidence_integrity_registry import scenarios
def scenario_registry(): return scenarios()
def evaluate_fixture(identifier,mode,now,operator,request_hash,context=None,controls=None):
 del now,controls
 result=evaluate(identifier,mode,operator,request_hash,context or {"contextHash":"fixture"})
 result.update({"scenarioId":identifier,"fixtureHash":digest(next(x for x in scenarios() if x["id"]==identifier)),"selectedPrerequisiteStatus":"requires_revalidation","maximumCalls":0,"actualProviderCalls":0,"elapsedMicros":0,"_artifacts":{"rootHash":result["rootHash"]}})
 return result
