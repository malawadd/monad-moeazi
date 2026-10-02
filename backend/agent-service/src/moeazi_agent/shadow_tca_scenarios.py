"""Adapter for checked-in Feature 33 scenarios only."""
from .shadow_tca_canonical import digest
from .shadow_tca_evaluator import evaluate
from .shadow_tca_registry import scenarios
def scenario_registry(): return scenarios()
def evaluate_fixture(identifier,mode,now,operator,request_hash,context=None,controls=None):
 del now,controls
 result=evaluate(identifier,mode,operator,request_hash,context)
 result.update({"scenarioId":identifier,"fixtureHash":digest(next(item for item in scenarios() if item["id"]==identifier))})
 return result
