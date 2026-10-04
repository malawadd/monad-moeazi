"""Scenario-ID-only adapter. No caller artifact or authority is accepted."""
from __future__ import annotations
from datetime import datetime
from .effective_authority_scenarios import evaluate_fixture, scenario_registry
FEATURE_ID="effective-authority-decision"
def evaluate(scenario_id:str, mode:str, now:datetime, operator:str, run_hash:str)->dict:
    if not any(row["id"]==scenario_id for row in scenario_registry()): raise ValueError("Unknown checked-in effective authority scenario")
    return evaluate_fixture(scenario_id,mode,now,operator,run_hash)
