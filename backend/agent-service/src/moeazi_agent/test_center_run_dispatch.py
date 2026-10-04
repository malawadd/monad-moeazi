"""Feature-local Test Center dispatch and persistence boundaries."""
from __future__ import annotations

from datetime import datetime


def evaluate_effective_authority(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str) -> tuple[dict, dict]:
    from .effective_authority_test_center_adapter import evaluate
    result = evaluate(scenario_id, mode, now, operator, run_hash)
    artifacts = result.pop("_artifacts")
    return result, artifacts


async def persist_effective_authority(engine, operator: str, idempotency_key: str, request_hash: str, artifacts: dict, payload: dict) -> dict:
    from .effective_authority_storage import EffectiveAuthorityRepository
    return await EffectiveAuthorityRepository(engine).persist_bundle(
        operator, idempotency_key, request_hash, artifacts["request"].scope, artifacts, payload
    )
