"""Exact activity substep responses, committed with their transactional effects."""
from __future__ import annotations

import json
from dataclasses import dataclass, field

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest, _hash
from .lifecycle_run_store import _run_params

PHASES = {"controls", "fold", "checkpoint", "entry", "cursor", "settlement", "protection",
          "resolution", "maintenance_select", "maintenance"}


@dataclass(frozen=True)
class PhaseCommand:
    scope: FinanceScope
    run_id: str
    manifest_hash: str
    command_id: str
    phase: str
    inputs: dict = field(default_factory=dict)

    def identity(self) -> dict:
        _hash(self.manifest_hash)
        if self.scope.environment != "experiment" or not self.run_id or \
                not self.command_id or len(self.command_id) > 200 or self.phase not in PHASES:
            raise FinanceError("Invalid simulation phase command identity")
        inputs = _canonical(self.inputs, 4096)
        return {**_run_params(self.scope, self.run_id), "manifest_hash": self.manifest_hash,
                "command_id": self.command_id, "phase": self.phase, "inputs": inputs}

    def bind(self, scope: FinanceScope, run_id: str, manifest_hash: str, phase: str) -> None:
        if (self.scope, self.run_id, self.manifest_hash, self.phase) != \
                (scope, run_id, manifest_hash, phase):
            raise FinanceError("Phase command differs from its operation")
        self.identity()


def _canonical(body: dict, limit: int) -> dict:
    if type(body) is not dict:
        raise FinanceError("Phase command payload must be an object")
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False, allow_nan=False)
    if len(encoded.encode("utf-8")) > limit:
        raise FinanceError("Phase command payload exceeds its size bound")
    return json.loads(encoded)


async def load_phase_receipt(conn, command: PhaseCommand) -> dict | None:
    identity = command.identity()
    row = (await conn.execute(text("""
        SELECT manifest_hash,input_hash,inputs_json,result_hash,result_json
        FROM simulation_phase_receipts WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id AND command_id=:command_id AND phase=:phase
    """), identity)).mappings().first()
    if row is None:
        return None
    expected_input = _digest("moeazi-simulation-phase-input-v1", identity)
    result = _canonical(row["result_json"], 65536)
    if row["manifest_hash"] != command.manifest_hash or \
            row["inputs_json"] != identity["inputs"] or row["input_hash"] != expected_input or \
            row["result_hash"] != _digest("moeazi-simulation-phase-result-v1",
                {"inputHash": expected_input, "result": result}):
        raise FinanceError("Simulation phase receipt identity conflicts")
    return result


async def store_phase_receipt(conn, command: PhaseCommand, result: dict) -> dict:
    """Caller holds account/run locks; use the SAME transaction as the effects.

    A no-op is also durable. A later signal or approval cannot turn an already
    completed substep into a new action while recovering the original activity.
    """
    identity = command.identity()
    canonical = _canonical(result, 65536)
    previous = await load_phase_receipt(conn, command)
    if previous is not None:
        if previous != canonical:
            raise FinanceError("Simulation phase response cannot be replaced")
        return previous
    input_hash = _digest("moeazi-simulation-phase-input-v1", identity)
    result_hash = _digest("moeazi-simulation-phase-result-v1",
                         {"inputHash": input_hash, "result": canonical})
    await conn.execute(text("""
        INSERT INTO simulation_phase_receipts(environment,scope_id,strategy_account_id,
          run_id,command_id,phase,manifest_hash,input_hash,inputs_json,result_hash,result_json)
        VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:command_id,:phase,
          :manifest_hash,:input_hash,CAST(:inputs AS jsonb),:result_hash,CAST(:result AS jsonb))
    """), {**identity, "input_hash": input_hash,
        "inputs": json.dumps(identity["inputs"], sort_keys=True, separators=(",", ":")),
        "result_hash": result_hash,
        "result": json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False)})
    return canonical
