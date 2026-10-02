"""Checked-in Feature 37 corpus inventory; callers cannot supply facts or verdicts."""
from .selective_prediction_canonical import digest
KINDS = ("eligible", "sparse", "stale", "outside", "warning", "conflict", "cost", "risk", "width", "multi", "corrected", "boundary")
HORIZONS = ("5m", "1h", "4h", "24h")
def scenarios():
    return tuple({"id": f"selective-prediction-{index:03d}", "operation": "evaluate_selective_prediction",
        "family": KINDS[(index - 1) % len(KINDS)], "horizon": HORIZONS[(index - 1) % len(HORIZONS)]}
        for index in range(1, 97))
def mutations(): return tuple(f"selective-prediction-mutation-{index:03d}" for index in range(1, 257))
def registry_hash(): return digest({"version": "selective-prediction-local-v1", "scenarios": scenarios(), "mutations": mutations()})
