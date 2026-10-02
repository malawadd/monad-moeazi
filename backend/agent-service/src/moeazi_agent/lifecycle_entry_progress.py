"""Immutable intermediate inputs for crash-safe simulated entry processing."""
from __future__ import annotations

import json
from typing import Literal

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest, _hash
from .lifecycle_run_store import _run_params

ProgressStep = Literal["evaluation", "admission", "preparation", "submission"]
STEPS = {"evaluation", "admission", "preparation", "submission"}


def _identity(scope: FinanceScope, run_id: str, manifest_hash: str,
              request_id: str, step: ProgressStep) -> dict:
    _hash(manifest_hash)
    if scope.environment != "experiment" or not run_id or not request_id or step not in STEPS:
        raise FinanceError("Invalid experimental entry progress identity")
    return {**_run_params(scope, run_id), "manifest_hash": manifest_hash,
            "request_id": request_id, "step": step}


def _progress_hash(identity: dict, body: dict) -> str:
    return _digest("moeazi-simulation-entry-progress-v1", {**identity, "payload": body})


async def load_entry_progress(conn, scope: FinanceScope, run_id: str,
                              manifest_hash: str, request_id: str,
                              step: ProgressStep) -> dict | None:
    identity = _identity(scope, run_id, manifest_hash, request_id, step)
    row = (await conn.execute(text("""
        SELECT manifest_hash,progress_hash,payload_json FROM simulation_entry_progress
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND request_id=:request_id AND step=:step
    """), identity)).mappings().first()
    if row is None:
        return None
    body = row["payload_json"]
    if row["manifest_hash"] != manifest_hash or not isinstance(body, dict) or \
            _progress_hash(identity, body) != row["progress_hash"]:
        raise FinanceError("Persisted entry progress differs from its immutable identity")
    return body


async def store_entry_progress(conn, scope: FinanceScope, run_id: str,
                               manifest_hash: str, request_id: str,
                               step: ProgressStep, body: dict) -> str:
    """Caller holds account/run locks; commit atomically with the phase it records."""
    identity = _identity(scope, run_id, manifest_hash, request_id, step)
    if type(body) is not dict:
        raise FinanceError("Entry progress must be a JSON object")
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False, allow_nan=False)
    if len(encoded.encode("utf-8")) > 65_536:
        raise FinanceError("Entry progress exceeds its bounded payload limit")
    canonical = json.loads(encoded)
    digest = _progress_hash(identity, canonical)
    previous = await load_entry_progress(conn, scope, run_id, manifest_hash, request_id, step)
    if previous is not None:
        if previous != canonical:
            raise FinanceError("Entry progress cannot be replaced during recovery")
        return digest
    await conn.execute(text("""
        INSERT INTO simulation_entry_progress(environment,scope_id,strategy_account_id,
          run_id,request_id,manifest_hash,step,progress_hash,payload_json)
        VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:request_id,
          :manifest_hash,:step,:hash,CAST(:body AS jsonb))
    """), {**identity, "hash": digest, "body": encoded})
    return digest
