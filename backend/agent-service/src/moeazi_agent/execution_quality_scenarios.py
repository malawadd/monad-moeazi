"""Checked-in adapters for isolated execution-quality route fixtures."""
from .execution_quality_canonical import digest
from .execution_quality_evaluator import evaluate
from .execution_quality_registry import scenarios
def scenario_registry(): return scenarios()
def evaluate_fixture(identifier,mode,now,operator,request_hash,context=None,controls=None):
 del now,controls
 result=evaluate(identifier,mode,operator,request_hash,context)
 result.update({"scenarioId":identifier,"fixtureHash":digest(next(item for item in scenarios() if item["id"]==identifier)),"_artifacts":{"rootHash":result["rootHash"],"registryHash":result["registryHash"]}})
 return result
