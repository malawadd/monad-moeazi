"""Feature 18 Test Center helper, separate from routing and authentication."""
from __future__ import annotations
from datetime import datetime
from .mandate_policy_test_center_adapter import evaluate
async def evaluate_mandate_policy(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str) -> dict:
    return evaluate(scenario_id,mode,now,operator,run_hash)

async def persist_mandate_policy(engine, operator: str, artifacts: dict, payload: dict) -> dict:
    """The isolated adapter owns Feature 18's local evidence translation."""
    from .mandate_policy_storage import TimescaleMandatePolicyRepository, test_center_bundle
    scope, evidence=test_center_bundle(artifacts["compilation"].receipt["scopeHash"],operator,artifacts)
    return await TimescaleMandatePolicyRepository(engine).persist_bundle(scope,evidence,payload)
