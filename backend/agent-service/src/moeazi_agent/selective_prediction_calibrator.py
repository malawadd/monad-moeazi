"""Frozen split-conformal integer quantiles and receipt projection."""
from .selective_prediction_contracts import ForecastObservation

CLASSES = ("long", "short", "neutral")
def ceil_div(value: int, divisor: int) -> int: return (value + divisor - 1) // divisor
def fit(rows: tuple[ForecastObservation, ...], coverage_bps: int = 9000):
    if len(rows) < 200: raise ValueError("INSUFFICIENT_LABELS")
    scores = []
    for row in rows:
        actual = CLASSES.index(row.realized_class); scores.append(10000 - row.probabilities_bps[actual])
    residuals = sorted(abs(row.realized_return_bps - row.forecast_return_bps) for row in rows)
    k = ceil_div((len(rows) + 1) * coverage_bps, 10000)
    if k > len(rows): raise ValueError("INSUFFICIENT_LABELS")
    return sorted(scores)[k - 1], residuals[k - 1]
def project(probabilities: tuple[int, int, int], forecast_return_bps: int, direction_threshold: int, return_threshold: int):
    selected = tuple(CLASSES[index] for index, probability in enumerate(probabilities) if 10000 - probability <= direction_threshold)
    return selected, forecast_return_bps - return_threshold, forecast_return_bps + return_threshold
