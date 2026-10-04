"""Scenario-only adapter. Inputs are scenario ids, never caller supplied rules."""
from .product_eligibility_scenarios import evaluate_fixture
def evaluate(scenario_id,mode,now,operator,run_hash): return evaluate_fixture(scenario_id,mode,now,operator,run_hash)
