"""Feature 17 Test Center helper, deliberately separate from API authorization/routing."""
from __future__ import annotations
from datetime import datetime
from .operator_qualification_test_center_adapter import evaluate

async def evaluate_operator_qualification(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str) -> dict:
    return evaluate(scenario_id,mode,now,operator,run_hash)
