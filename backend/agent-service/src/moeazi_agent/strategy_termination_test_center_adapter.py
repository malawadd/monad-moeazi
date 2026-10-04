"""Bounded Test Center adapter; it only evaluates checked-in fixture IDs."""
from __future__ import annotations
from datetime import datetime
from .strategy_termination_scenarios import evaluate_fixture, scenario_registry

FEATURE_ID = "verified-strategy-termination"

def evaluate(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str, closure_hash: str,
             prerequisites: dict) -> dict:
    if not any(item["id"] == scenario_id for item in scenario_registry()):
        raise ValueError("Unknown checked-in termination scenario")
    return evaluate_fixture(scenario_id, mode, now, operator, run_hash, closure_hash, prerequisites)
