"""Feature-16 adapter accepts only registered ID, frozen time, operator and run hash."""
from __future__ import annotations
from datetime import datetime
from .safety_change_quorum_scenarios import evaluate_fixture, scenario_registry
FEATURE_ID="safety-change-quorum"
def evaluate(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str) -> dict:
    if not any(x["id"]==scenario_id for x in scenario_registry()): raise ValueError("Unknown checked-in safety change quorum scenario")
    return evaluate_fixture(scenario_id, mode, now, operator, run_hash)
