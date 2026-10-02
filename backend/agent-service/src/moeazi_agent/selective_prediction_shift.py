"""Monotone shift classification over typed fixture facts only."""
def classify(coverage_gap_bps: int | None, width_change_bps: int | None, quality_change_bps: int | None):
    if any(value is None for value in (coverage_gap_bps, width_change_bps, quality_change_bps)): return "insufficient"
    severe = coverage_gap_bps > 1000 or width_change_bps > 2500 or quality_change_bps < -2000
    warning = coverage_gap_bps > 500 or width_change_bps > 1000 or quality_change_bps < -1000
    return "outside" if severe else "warning" if warning else "inside"
