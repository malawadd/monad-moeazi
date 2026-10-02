"""Feature 34 checked-in fixture adapter."""
from .run_planning_canonical import digest
from .run_planning_evaluator import evaluate
from .run_planning_registry import scenarios
def scenario_registry(): return scenarios()
def evaluate_fixture(identifier,mode,now,operator,run_hash,context=None,controls=None):
 del now,controls
 result=evaluate(identifier,mode,operator,run_hash,context)
 result.update({"scenarioId":identifier,"fixtureHash":digest(next(x for x in scenarios() if x["id"]==identifier))})
 result["_artifacts"]={"rootHash":result["rootHash"],"registryHash":result["registryHash"]}
 return result
