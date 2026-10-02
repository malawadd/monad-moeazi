"""Only bridge from Test Center to the frozen local evaluator."""
from .claim_disagreement_scenarios import evaluate_fixture
def evaluate(scenario_id,mode,now,operator,run_hash,context=None,controls=None): return evaluate_fixture(scenario_id,mode,now,operator,run_hash,context)
