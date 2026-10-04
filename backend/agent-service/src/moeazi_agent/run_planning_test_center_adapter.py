"""Only bridge between Test Center and deterministic run planning fixtures."""
from .run_planning_scenarios import evaluate_fixture
def evaluate(scenario_id,mode,now,operator,run_hash,context=None,controls=None): return evaluate_fixture(scenario_id,mode,now,operator,run_hash,context,controls)
