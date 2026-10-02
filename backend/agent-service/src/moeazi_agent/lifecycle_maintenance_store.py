"""Atomically bind a reserved simulated close to its source obligations."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest, db_native_int
from .lifecycle_contracts import TradeIntent
from .lifecycle_maintenance_contracts import (
    MaintenanceObligationRef, MaintenanceReductionReceipt, maintenance_order_id,
)
from .lifecycle_replay_finance_contracts import ReplaySizingReceipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params


async def store_maintenance_mandate(
    conn, scope: FinanceScope, run_id: str, manifest_hash: str, command_id: str,
    sizing: ReplaySizingReceipt, intent: TradeIntent, reservation_id: str,
) -> MaintenanceReductionReceipt:
    """Caller writes receipt, intent and hold in this same locked transaction."""
    if scope.environment != "experiment" or not command_id or not reservation_id:
        raise FinanceError("maintenance mandate needs a scoped stable command")
    params = _run_params(scope, run_id)
    values = {**params, "command": command_id, "reservation": reservation_id,
              "receipt": sizing.receipt_hash, "intent": intent.intent_id}
    account = (await conn.execute(text("""
        SELECT * FROM finance_accounts WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id FOR UPDATE
    """), params)).mappings().one()
    run = (await conn.execute(text("""
        SELECT * FROM simulation_runs WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id FOR UPDATE
    """), params)).mappings().one()
    prior = (await conn.execute(text("""
        SELECT receipt_json FROM simulation_maintenance_reductions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND command_id=:command
    """), values)).scalar_one_or_none()
    if prior is not None:
        result = MaintenanceReductionReceipt.model_validate_json(json.dumps(prior))
        if result.sizing_receipt_hash != sizing.receipt_hash or \
                result.intent_hash != intent.intent_hash or \
                result.reservation_id != reservation_id:
            raise FinanceError("maintenance command retry changed its economics")
        return result
    manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
    command = (await conn.execute(text("""
        SELECT command_hash,operation,target_id,outcome,requested_by_subject
        FROM simulation_commands WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id AND command_id=:command
    """), values)).mappings().first()
    held = (await conn.execute(text("""
        SELECT * FROM finance_reservations WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND reservation_id=:reservation
    """), values)).mappings().first()
    stored_sizing = (await conn.execute(text("""
        SELECT receipt_json FROM finance_calculation_receipts
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND receipt_hash=:receipt
    """), values)).scalar_one_or_none()
    stored_intent = (await conn.execute(text("""
        SELECT intent_json FROM simulation_intents WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id AND intent_id=:intent
    """), values)).scalar_one_or_none()
    if run["manifest_hash"] != manifest_hash or \
            run["status"] in {"quarantined", "completed_flat"} or \
            manifest.manifest_hash != manifest_hash or \
            manifest.scope != scope or command is None or \
            command["operation"] != "request_close" or command["outcome"] != "applied" or \
            command["target_id"] != sizing.instrument_version_id or \
            command["requested_by_subject"] != run["created_by_subject"] or \
            account["reconciliation_state"] != "clean" or \
            account["admission_state"] not in {"open", "stopped"} or \
            sizing.scope != scope or sizing.run_id != run_id or \
            sizing.manifest_hash != manifest_hash or \
            sizing.code_version != "replay-sizing-v2" or \
            sizing.request_id != "maintenance:" + command["command_hash"] or \
            sizing.account_snapshot_hash != account["observation_snapshot_hash"] or \
            int(sizing.account_revision) + 1 != account["revision"] or \
            sizing.execution_envelope is None or sizing.position_state is None or \
            sizing.position_state_hash is None or sizing.position_revision is None or \
            intent.scope != scope or intent.run_id != run_id or \
            intent.run_manifest_hash != manifest_hash or \
            intent.calculation_receipt_hash != sizing.receipt_hash or \
            intent.controller_ref != manifest.controller_ref or \
            intent.action != sizing.action or intent.side != sizing.side or \
            held is None or held["status"] != "reserved" or \
            held["calculation_receipt_hash"] != sizing.receipt_hash or \
            held["intent_id"] != intent.intent_id or \
            held["admitted_revision"] != account["revision"] or \
            held["authority_epoch"] != account["authority_epoch"] or \
            stored_sizing != sizing.model_dump(mode="json") or \
            stored_intent != intent.model_dump(mode="json"):
        raise FinanceError("maintenance mandate lacks current owner or finance proof")
    position = (await conn.execute(text("""
        SELECT * FROM simulation_positions WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id AND instrument_version_id=:instrument
          AND location_id=:location FOR UPDATE
    """), {**params, "instrument": sizing.instrument_version_id,
           "location": sizing.location_id})).mappings().first()
    obligations = (await conn.execute(text("""
        SELECT run_id,location_id,status,protection_order_id,intended_hash,
          originating_event_hash FROM simulation_protections
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id
          AND instrument_version_id=:instrument AND resolution_hash IS NULL
        ORDER BY protection_order_id
    """), {**params, "instrument": sizing.instrument_version_id})).mappings().all()
    if position is None or position["reconciliation_state"] != "clean" or \
            position["arithmetic_state_hash"] != sizing.position_state_hash or \
            position["revision"] != sizing.position_revision or \
            position["arithmetic_state_json"] != \
                sizing.position_state.model_dump(mode="json") or \
            not obligations or any(row["run_id"] != run_id or \
                row["location_id"] != sizing.location_id or \
                row["status"] != "intended" or \
                row["originating_event_hash"] is None for row in obligations):
        raise FinanceError("maintenance mandate lacks exact unresolved position")
    refs = tuple(MaintenanceObligationRef(
        protection_order_id=row["protection_order_id"],
        intended_hash=row["intended_hash"],
        originating_event_hash=row["originating_event_hash"])
        for row in obligations)
    body = dict(schema_version=1, scope=scope, controller_ref=manifest.controller_ref,
        run_id=run_id, manifest_hash=manifest_hash, command_id=command_id,
        command_hash=command["command_hash"],
        maintenance_order_id=maintenance_order_id(scope, run_id, command_id,
                                                  command["command_hash"]),
        order_ordinal=sizing.order_ordinal,
        instrument_version_id=sizing.instrument_version_id,
        location_id=sizing.location_id,
        anchor_protection_order_id=refs[0].protection_order_id,
        obligations=refs, account_snapshot_hash=account["observation_snapshot_hash"],
        account_revision=account["revision"],
        authority_epoch=account["authority_epoch"],
        position_state_hash=sizing.position_state_hash,
        position_revision=sizing.position_revision,
        signed_exposure_units=str(db_native_int(position["signed_exposure_units"])),
        reduction_action=sizing.action, side=sizing.side,
        quantity_units=sizing.quantity_units, decision_hash=sizing.decision_hash,
        sizing_receipt_hash=sizing.receipt_hash, reservation_id=reservation_id,
        intent_id=intent.intent_id, intent_hash=intent.intent_hash,
        execution_envelope_hash=sizing.execution_envelope.envelope_hash)
    digest_body = MaintenanceReductionReceipt.model_construct(**body).model_dump(
        mode="json", exclude={"receipt_hash"})
    result = MaintenanceReductionReceipt.model_validate({**body,
        "receipt_hash": _digest("moeazi-maintenance-reduction-v1", digest_body)})
    await conn.execute(text("""
        INSERT INTO simulation_maintenance_reductions(environment,scope_id,
          strategy_account_id,run_id,receipt_hash,manifest_hash,command_id,
          command_hash,maintenance_order_id,instrument_version_id,location_id,
          order_ordinal,
          anchor_protection_order_id,account_snapshot_hash,account_revision,
          authority_epoch,position_state_hash,position_revision,
          signed_exposure_units,reduction_action,side,quantity_units,decision_hash,
          sizing_receipt_hash,reservation_id,intent_id,intent_hash,
          execution_envelope_hash,receipt_json)
        VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:receipt_hash,
          :manifest_hash,:command_id,:command_hash,:maintenance_order_id,
          :instrument_version_id,:location_id,:order_ordinal,
          :anchor_protection_order_id,
          :account_snapshot_hash,:account_revision,:authority_epoch,
          :position_state_hash,:position_revision,:signed_exposure_units,
          :reduction_action,:side,:quantity_units,:decision_hash,
          :sizing_receipt_hash,:reservation_id,:intent_id,:intent_hash,
          :execution_envelope_hash,CAST(:receipt_json AS jsonb))
    """), {**params, **result.model_dump(mode="json"),
           "receipt_json": result.model_dump_json()})
    for row in refs:
        await conn.execute(text("""
            INSERT INTO simulation_maintenance_obligation_links(environment,scope_id,
              strategy_account_id,run_id,receipt_hash,protection_order_id,
              intended_hash,originating_event_hash)
            VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:receipt,
              :protection,:intended,:event)
        """), {**params, "receipt": result.receipt_hash,
               "protection": row.protection_order_id,
               "intended": row.intended_hash,
               "event": row.originating_event_hash})
    return result
