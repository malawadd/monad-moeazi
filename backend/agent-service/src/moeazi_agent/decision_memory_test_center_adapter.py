"""Only Test Center bridge to the Feature 35 fixture evaluator."""
from .decision_memory_scenarios import evaluate_fixture


def evaluate(scenario_id, mode, now, operator, run_hash, context=None, controls=None):
    return evaluate_fixture(scenario_id, mode, now, operator, run_hash, context, controls)
