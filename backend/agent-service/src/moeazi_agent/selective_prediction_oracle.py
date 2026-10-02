"""Independent state oracle; it intentionally does not import the evaluator."""
from .selective_prediction_registry import scenarios
def expected(identifier: str, mode: str):
    family = next(row["family"] for row in scenarios() if row["id"] == identifier)
    value = "proposal_eligible" if family == "eligible" else "shadow_only" if family == "warning" else "abstain"
    return "shadow_only" if mode == "observe" and value == "proposal_eligible" else value
