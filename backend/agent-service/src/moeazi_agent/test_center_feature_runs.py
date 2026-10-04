"""Feature-specific Test Center dispatch helpers kept outside auth/API routing."""
from __future__ import annotations
from datetime import datetime

async def evaluate_incident_communication(scenario_id: str, mode: str, now: datetime,
                                          operator: str, run_hash: str) -> dict:
    from .incident_communication_test_center_adapter import evaluate
    return evaluate(scenario_id, mode, now, operator, run_hash)

async def evaluate_safety_change_quorum(scenario_id: str, mode: str, now: datetime,
                                        operator: str, run_hash: str) -> dict:
    from .safety_change_quorum_test_center_adapter import evaluate
    return evaluate(scenario_id, mode, now, operator, run_hash)

async def evaluate_operator_qualification(scenario_id: str, mode: str, now: datetime,
                                          operator: str, run_hash: str) -> dict:
    from .operator_qualification_test_center_adapter import evaluate
    return evaluate(scenario_id, mode, now, operator, run_hash)
