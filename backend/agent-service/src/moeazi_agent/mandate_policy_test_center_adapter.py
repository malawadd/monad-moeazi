"""Narrow Test Center entry point; inputs are IDs and frozen metadata only."""
from __future__ import annotations
from datetime import datetime
from .mandate_policy_scenarios import evaluate_fixture, scenario_registry
FEATURE_ID="mandate-policy-semantic-fidelity"
def evaluate(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str) -> dict:
    if not any(row["id"]==scenario_id for row in scenario_registry()): raise ValueError("Unknown checked-in mandate policy scenario")
    return evaluate_fixture(scenario_id,mode,now,operator,run_hash)
