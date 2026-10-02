"""The only Test Center bridge for calibrated selective prediction."""
from .selective_prediction_evaluator import evaluate as _evaluate
def evaluate(scenario_id, mode, now, operator, run_hash, context=None, controls=None):
    del now
    return _evaluate(scenario_id, mode, operator, run_hash, context, controls)
