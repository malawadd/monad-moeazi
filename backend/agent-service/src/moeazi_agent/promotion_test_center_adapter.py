"""The only Test Center bridge for outcome-calibrated promotion."""
from .promotion_evaluator import evaluate as _evaluate
def evaluate(scenario_id, mode, now, operator, run_hash, context=None, controls=None):
    del now, controls
    return _evaluate(scenario_id, mode, operator, run_hash, context)
