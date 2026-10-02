"""Recheck a typed owner close mandate before preparing or starting reduction."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, db_native_int, native_int
from .lifecycle_maintenance_contracts import (
    MaintenanceObligationRef, MaintenanceReductionReceipt,
)
from .lifecycle_run_store import _run_params


async def maintenance_for_intent(conn, scope, run_id: str,
        intent_id: str, reservation_id: str) -> MaintenanceReductionReceipt | None:
    row = (await conn.execute(text("""
        SELECT receipt_json FROM simulation_maintenance_reductions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND intent_id=:intent AND reservation_id=:reservation
    """), {**_run_params(scope, run_id), "intent": intent_id,
           "reservation": reservation_id})).scalar_one_or_none()
    return (MaintenanceReductionReceipt.model_validate_json(json.dumps(row))
            if row is not None else None)


async def maintenance_for_order(conn, scope, run_id: str,
        order_id: str) -> MaintenanceReductionReceipt | None:
    row = (await conn.execute(text("""
        SELECT receipt_json FROM simulation_maintenance_reductions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND maintenance_order_id=:order_id
    """), {**_run_params(scope, run_id),
           "order_id": order_id})).scalar_one_or_none()
    return (MaintenanceReductionReceipt.model_validate_json(json.dumps(row))
            if row is not None else None)


async def verify_maintenance(conn, manifest, run: dict, account: dict,
        intent, reservation: dict, mandate: MaintenanceReductionReceipt,
        *, order_id: str) -> str:
    """Authority is the persisted owner command plus current clean residual."""
    if mandate.scope != manifest.scope or mandate.run_id != manifest.run_id or \
            mandate.controller_ref != manifest.controller_ref or \
            mandate.manifest_hash != manifest.manifest_hash or \
            mandate.maintenance_order_id != order_id or \
            mandate.intent_id != intent.intent_id or \
            mandate.intent_hash != intent.intent_hash or \
            intent.maintenance_command_hash != mandate.command_hash or \
            mandate.reservation_id != reservation["reservation_id"] or \
            mandate.sizing_receipt_hash != intent.calculation_receipt_hash or \
            mandate.instrument_version_id != intent.instrument_version_id or \
            mandate.reduction_action != intent.action or \
            mandate.side != intent.side or \
            mandate.decision_hash != intent.decision_context_hash or \
            mandate.account_snapshot_hash != account["observation_snapshot_hash"] or \
            mandate.account_revision != account["revision"] or \
            mandate.authority_epoch != account["authority_epoch"] or \
            mandate.authority_epoch != reservation["authority_epoch"] or \
            account["reconciliation_state"] != "clean" or \
            run["manifest_hash"] != manifest.manifest_hash or \
            run["status"] in {"quarantined", "completed_flat"} or \
            account["admission_state"] not in {"open", "stopped"}:
        raise FinanceError("maintenance mandate differs from current controlled reduction")
    params = _run_params(manifest.scope, manifest.run_id)
    command = (await conn.execute(text("""
        SELECT command_hash,operation,target_id,outcome,requested_by_subject
        FROM simulation_commands WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id AND command_id=:command
    """), {**params, "command": mandate.command_id})).mappings().first()
    if command is None or command["command_hash"] != mandate.command_hash or \
            command["operation"] != "request_close" or \
            command["target_id"] != mandate.instrument_version_id or \
            command["outcome"] != "applied" or \
            command["requested_by_subject"] != run["created_by_subject"]:
        raise FinanceError("maintenance command lacks authenticated owner lineage")
    position = (await conn.execute(text("""
        SELECT arithmetic_state_hash,revision,signed_exposure_units,
               reconciliation_state FROM simulation_positions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND instrument_version_id=:instrument AND location_id=:location FOR UPDATE
    """), {**params, "instrument": mandate.instrument_version_id,
           "location": mandate.location_id})).mappings().first()
    if position is None or position["arithmetic_state_hash"] != \
            mandate.position_state_hash or position["revision"] != \
            mandate.position_revision or native_int(mandate.signed_exposure_units) != \
            db_native_int(position["signed_exposure_units"]) or \
            position["reconciliation_state"] != "clean" or \
            native_int(mandate.quantity_units) > abs(native_int(
                mandate.signed_exposure_units)):
        raise FinanceError("maintenance position changed before reduction")
    rows = (await conn.execute(text("""
        SELECT run_id,location_id,protection_order_id,intended_hash,
               originating_event_hash,originating_order_id
        FROM simulation_protections WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND instrument_version_id=:instrument AND resolution_hash IS NULL
        ORDER BY protection_order_id
    """), {**params, "instrument": mandate.instrument_version_id})).mappings().all()
    obligations = tuple(MaintenanceObligationRef(
        protection_order_id=row["protection_order_id"],
        intended_hash=row["intended_hash"],
        originating_event_hash=row["originating_event_hash"])
        for row in rows)
    if any(row["run_id"] != manifest.run_id or
           row["location_id"] != mandate.location_id for row in rows) or \
            obligations != mandate.obligations:
        raise FinanceError("maintenance obligation set changed")
    anchor = next(row for row in rows if row["protection_order_id"] ==
                  mandate.anchor_protection_order_id)
    return anchor["originating_order_id"]
