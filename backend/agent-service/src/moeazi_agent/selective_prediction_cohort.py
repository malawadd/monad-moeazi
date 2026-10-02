"""Point-in-time non-overlap/embargo cohort construction."""
from .selective_prediction_contracts import ForecastObservation

def build(observations: tuple[ForecastObservation, ...], cutoff: str, embargo_seconds: int = 0):
    del embargo_seconds
    included, excluded, previous_end = [], [], ""
    for row in sorted(observations, key=lambda value: (value.decision_at, value.observation_hash)):
        reason = None
        if row.label_observed_at > cutoff or row.horizon_ends_at > cutoff or not row.costs_complete: reason = "UNMATURE_OR_INCOMPLETE"
        elif previous_end and row.decision_at < previous_end: reason = "OVERLAP_OR_EMBARGO"
        if reason: excluded.append((row.observation_hash, reason))
        else: included.append(row); previous_end = row.horizon_ends_at
    return tuple(included), tuple(excluded)
