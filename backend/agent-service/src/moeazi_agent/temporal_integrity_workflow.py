"""Unregistered deterministic workflow command helper; never starts a worker."""
from __future__ import annotations
from .temporal_integrity_contracts import digest
def fixture_commands(run_id: str, decision_hash: str) -> list[dict]:
    body = {"runId": run_id, "decisionHash": decision_hash, "command": "record_fixture_result"}
    return [{**body, "commandHash": digest(body)}]
