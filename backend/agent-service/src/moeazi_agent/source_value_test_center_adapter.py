"""Only Test Center bridge for the synthetic source-value evaluator."""
from .source_value_scenarios import evaluate_fixture
def evaluate(scenario_id,mode,now,operator,run_hash,context=None,controls=None): return evaluate_fixture(scenario_id,mode,now,operator,run_hash,context,controls)
