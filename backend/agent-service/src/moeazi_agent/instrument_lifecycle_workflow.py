"""Unregistered deterministic metadata-only propagation command reducer."""
from __future__ import annotations
from .instrument_lifecycle_contracts import digest

def fixture_commands(run_id: str, decision_hash: str, invalidation_total: int) -> list[dict]:
    body = {"runId": run_id, "decisionHash": decision_hash, "invalidationTotal": invalidation_total,
        "command": "record_fixture_lifecycle_projection"}
    return [{**body, "commandHash": digest(body)}]
