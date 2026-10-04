"""Only scenario identifiers reach this isolated fixture adapter."""
from __future__ import annotations
from .usage_rights_scenarios import evaluate_fixture, scenario_registry

FEATURE_ID = "external-usage-rights"


def evaluate(scenario_id, mode, now, operator, run_hash):
    if not any(row["id"] == scenario_id for row in scenario_registry()):
        raise ValueError("Unknown checked-in usage rights scenario")
    return evaluate_fixture(scenario_id, mode, now, operator, run_hash)
