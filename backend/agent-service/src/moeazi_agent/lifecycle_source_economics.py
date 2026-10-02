"""Read immutable calculation inputs for linear source replay."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError
from .finance_policy import SizingPolicy
from .lifecycle_contracts import ExecutionPermit
from .lifecycle_position_math_contracts import PositionArithmeticState
from .lifecycle_replay_finance_contracts import ReplaySizingReceipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params


async def load_source_economics(conn, manifest: SimulationRunManifest,
        permits: tuple[ExecutionPermit, ...]
        ) -> tuple[dict[str, PositionArithmeticState], int | None]:
    """A reduction's source basis comes from its held, hash-bound receipt."""
    if not any(item.quantity_kind == "contracts" for item in permits):
        return {}, None
    params = _run_params(manifest.scope, manifest.run_id)
    policy_row = (await conn.execute(text("""
        SELECT policy_json,policy_hash FROM finance_policy_versions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND policy_version=:version
    """), {**params, "version": manifest.policy_version})).mappings().first()
    if policy_row is None or policy_row["policy_hash"] != manifest.policy_hash:
        raise FinanceError("source replay lacks immutable margin policy")
    policy = SizingPolicy.model_validate_json(json.dumps(policy_row["policy_json"]))
    if policy.policy_hash != manifest.policy_hash:
        raise FinanceError("source replay margin policy body differs")
    reductions = {item.order_id: item for item in permits if item.action in
                  {"perp_reduce", "perp_close"}}
    if not reductions:
        return {}, policy.initial_margin_bps
    rows = (await conn.execute(text("""
        SELECT p.order_id,p.reservation_id,p.calculation_receipt_hash,c.receipt_json
        FROM simulation_order_preparations p JOIN finance_calculation_receipts c
          ON c.environment=p.environment AND c.scope_id=p.scope_id
          AND c.strategy_account_id=p.strategy_account_id
          AND c.receipt_hash=p.calculation_receipt_hash
        WHERE p.environment=:environment AND p.scope_id=:scope_id
          AND p.strategy_account_id=:strategy_account_id AND p.run_id=:run_id
          AND p.order_id = ANY(CAST(:ids AS text[]))
    """), {**params, "ids": list(reductions)})).mappings().all()
    if {row["order_id"] for row in rows} != set(reductions):
        raise FinanceError("linear reduction has no exact frozen calculation")
    anchors: dict[str, PositionArithmeticState] = {}
    for row in rows:
        permit = reductions[row["order_id"]]
        receipt = ReplaySizingReceipt.model_validate_json(
            json.dumps(row["receipt_json"]))
        envelope = permit.execution_envelope
        if receipt.code_version != "replay-sizing-v2" or envelope is None or \
                receipt.receipt_hash != row["calculation_receipt_hash"] or \
                permit.reservation_id != row["reservation_id"] or \
                receipt.scope != manifest.scope or receipt.run_id != manifest.run_id or \
                receipt.manifest_hash != manifest.manifest_hash or \
                receipt.instrument_version_id != permit.instrument_version_id or \
                receipt.instrument_registry_hash != permit.instrument_registry_hash or \
                receipt.location_id != permit.location_id or \
                receipt.action != permit.action or receipt.side != permit.side or \
                receipt.quantity_units != permit.quantity_units or \
                receipt.decision_hash != permit.decision_context_hash or \
                receipt.execution_envelope != envelope or \
                receipt.position_state is None or \
                receipt.position_state_hash != envelope.position_state_hash or \
                receipt.position_revision != envelope.position_revision:
            raise FinanceError("linear source anchor differs from held order")
        anchors[permit.order_id] = receipt.position_state
    return anchors, policy.initial_margin_bps
