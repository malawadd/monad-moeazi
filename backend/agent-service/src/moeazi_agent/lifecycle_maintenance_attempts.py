"""Validate a submitted close attempt against its immutable owner mandate."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, native_int
from .lifecycle_maintenance_contracts import MaintenanceReductionReceipt
from .lifecycle_run_store import _run_params


async def require_maintenance_attempt(conn, permit) -> MaintenanceReductionReceipt:
    if permit.maintenance_receipt_hash is None or permit.execution_envelope is None:
        raise FinanceError("maintenance attempt lacks typed causal authority")
    params = _run_params(permit.scope, permit.run_id)
    mandate = (await conn.execute(text("""
        SELECT receipt_json FROM simulation_maintenance_reductions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND receipt_hash=:receipt AND maintenance_order_id=:order_id
    """), {**params, "receipt": permit.maintenance_receipt_hash,
           "order_id": permit.order_id})).scalar_one_or_none()
    if mandate is None:
        raise FinanceError("submitted reduction lacks its persisted close mandate")
    receipt = MaintenanceReductionReceipt.model_validate_json(json.dumps(mandate))
    anchor = (await conn.execute(text("""
        SELECT originating_order_id FROM simulation_protections
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND protection_order_id=:anchor
    """), {**params, "anchor": receipt.anchor_protection_order_id})).scalar_one_or_none()
    stored = (await conn.execute(text("""
        SELECT permit_json FROM simulation_orders WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id AND order_id=:order_id
    """), {**params, "order_id": permit.order_id})).scalar_one_or_none()
    if receipt.scope != permit.scope or receipt.controller_ref != permit.controller_ref or \
            receipt.run_id != permit.run_id or \
            receipt.manifest_hash != permit.run_manifest_hash or \
            receipt.maintenance_order_id != permit.order_id or \
            receipt.intent_id != permit.intent_id or \
            receipt.intent_hash != permit.intent_hash or \
            receipt.reservation_id != permit.reservation_id or \
            receipt.instrument_version_id != permit.instrument_version_id or \
            receipt.location_id != permit.location_id or \
            receipt.reduction_action != permit.action or \
            receipt.side != permit.side or \
            native_int(receipt.quantity_units) != native_int(permit.quantity_units) or \
            receipt.decision_hash != permit.decision_context_hash or \
            receipt.execution_envelope_hash != \
                permit.execution_envelope.envelope_hash or \
            permit.protection_order_id != permit.order_id or \
            permit.originating_order_id != anchor or \
            stored != permit.model_dump(mode="json"):
        raise FinanceError("submitted reduction differs from close mandate")
    return receipt
