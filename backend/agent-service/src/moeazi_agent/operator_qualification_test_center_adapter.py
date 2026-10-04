"""Narrow Test Center entry point; no caller-supplied people, artifacts or controls."""
from __future__ import annotations
from datetime import datetime
from .operator_qualification_scenarios import evaluate_fixture, scenario_registry
FEATURE_ID="operator-qualification"
def evaluate(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str) -> dict:
    if not any(item["id"]==scenario_id for item in scenario_registry()): raise ValueError("Unknown checked-in operator qualification scenario")
    return evaluate_fixture(scenario_id,mode,now,operator,run_hash)
