"""Issue one source-bound, owner-requested experimental close mandate."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _hash, db_native_int, native_int
from .lifecycle_contracts import TradeIntent
from .lifecycle_maintenance_contracts import MaintenanceReductionReceipt
from .lifecycle_maintenance_decision import ensure_maintenance_decision
from .lifecycle_maintenance_hold import reserve_maintenance_close
from .lifecycle_maintenance_inputs import load_maintenance_inputs
from .lifecycle_maintenance_intent import build_maintenance_intent
from .lifecycle_order_ordinals import allocate_order_ordinal
from .lifecycle_replay_sizing import build_replay_sizing_receipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params


async def _prior(conn, params: dict, command_id: str):
    row = (await conn.execute(text("""
        SELECT receipt_json FROM simulation_maintenance_reductions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND command_id=:command
    """), {**params, "command": command_id})).scalar_one_or_none()
    return MaintenanceReductionReceipt.model_validate_json(json.dumps(row)) \
        if row is not None else None


async def _prior_attempt_pending(conn, params: dict, instrument_id: str) -> bool:
    return (await conn.execute(text("""
        SELECT EXISTS (SELECT 1 FROM simulation_maintenance_reductions m
          LEFT JOIN simulation_orders o ON o.environment=m.environment
            AND o.scope_id=m.scope_id AND o.strategy_account_id=m.strategy_account_id
            AND o.run_id=m.run_id AND o.order_id=m.maintenance_order_id
          LEFT JOIN finance_reservations h ON h.environment=m.environment
            AND h.scope_id=m.scope_id AND h.strategy_account_id=m.strategy_account_id
            AND h.reservation_id=m.reservation_id
          LEFT JOIN simulation_reservation_resolutions z
            ON z.environment=m.environment AND z.scope_id=m.scope_id
            AND z.strategy_account_id=m.strategy_account_id AND z.run_id=m.run_id
            AND z.order_id=m.maintenance_order_id
          WHERE m.environment=:environment AND m.scope_id=:scope_id
            AND m.strategy_account_id=:strategy_account_id AND m.run_id=:run_id
            AND m.instrument_version_id=:instrument
            AND (o.order_id IS NULL OR o.status NOT IN ('filled','cancelled','rejected')
              OR o.terminal_event_hash IS NULL OR h.status NOT IN ('settled','released')
              OR h.resolution_proof_hash IS NULL OR z.reservation_id IS NULL
              OR z.reservation_id IS DISTINCT FROM m.reservation_id
              OR z.resolution_hash IS DISTINCT FROM h.resolution_proof_hash
              OR z.terminal_event_hash IS DISTINCT FROM o.terminal_event_hash
              OR z.terminal_order_status IS DISTINCT FROM o.status))
    """), {**params, "instrument": instrument_id})).scalar_one()


async def _prior_intent(conn, params: dict,
                        mandate: MaintenanceReductionReceipt) -> TradeIntent:
    row = (await conn.execute(text("""
        SELECT intent_hash,intent_json FROM simulation_intents
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND intent_id=:intent
    """), {**params, "intent": mandate.intent_id})).mappings().first()
    if row is None:
        raise FinanceError("maintenance mandate has no committed intent")
    intent = TradeIntent.model_validate_json(json.dumps(row["intent_json"]))
    if intent.intent_hash != row["intent_hash"] or \
            intent.intent_hash != mandate.intent_hash or \
            intent.calculation_receipt_hash != mandate.sizing_receipt_hash or \
            intent.maintenance_command_hash != mandate.command_hash:
        raise FinanceError("maintenance intent changed after mandate commit")
    return intent


class LifecycleMaintenanceIssuanceMixin:
    async def issue_maintenance_reduction(self, scope: FinanceScope, run_id: str,
            manifest_hash: str, command_id: str, *, worker_id: str) -> dict:
        """Reserve the exact residual and prepare it; no new-entry callback."""
        _hash(manifest_hash)
        if scope.environment != "experiment" or not run_id or not command_id or \
                not worker_id:
            raise FinanceError("maintenance issuance needs a scoped worker command")
        params = _run_params(scope, run_id)
        epoch = await self.finance.acquire_writer_epoch(scope, worker_id)
        mandate = None
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            now = await self.finance._writer(conn, account, epoch)
            if run["manifest_hash"] != manifest_hash:
                raise FinanceError("maintenance run manifest differs")
            manifest = SimulationRunManifest.model_validate_json(
                json.dumps(run["manifest_json"]))
            mandate = await _prior(conn, params, command_id)
            if mandate is None:
                if run["status"] in {"quarantined", "completed_flat"}:
                    raise FinanceError("maintenance run cannot mint a new close")
                command = (await conn.execute(text("""
                    SELECT command_id,command_hash,operation,target_id,outcome,
                      requested_by_subject FROM simulation_commands
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                      AND command_id=:command
                """), {**params, "command": command_id})).mappings().first()
                if command is None or command["operation"] != "request_close" or \
                        command["outcome"] != "applied" or \
                        command["requested_by_subject"] != run["created_by_subject"]:
                    raise FinanceError("maintenance requires exact authenticated close")
                instrument_id = command["target_id"]
                if account["reconciliation_state"] != "clean" or \
                        account["admission_state"] not in {"open", "stopped"} or \
                        await _prior_attempt_pending(conn, params, instrument_id):
                    return {"commandId": command_id, "status": "awaiting_finance"}
                decision = await ensure_maintenance_decision(conn, scope, run,
                    account, instrument_id)
                if decision is None:
                    return {"commandId": command_id, "status": "awaiting_evidence"}
                inputs = await load_maintenance_inputs(conn, scope, run, account,
                    instrument_id, decision.decision_hash)
                if inputs["manifest"] != manifest:
                    raise FinanceError("maintenance inputs differ from frozen manifest")
                instrument = inputs["instrument"]
                if instrument.product_kind != "spot":
                    return {"commandId": command_id, "status": "awaiting_finance",
                            "reason": "linear_reduction_admission_unqualified"}
                position = inputs["position_row"]
                quantity = db_native_int(position["signed_exposure_units"])
                if quantity <= 0:
                    raise FinanceError("maintenance spot close requires long inventory")
                ordinal = await allocate_order_ordinal(conn, scope, run_id,
                    manifest_hash, "maintenance", command_id)
                receipt = build_replay_sizing_receipt(manifest, decision,
                    inputs["policy"], instrument, inputs["book"],
                    inputs["evidence"], inputs["dataset"], inputs["snapshot"],
                    inputs["positions"], inputs["pending_receipts"],
                    request_id="maintenance:" + command["command_hash"],
                    action="spot_sell", side="sell",
                    desired_quantity_units=str(quantity), order_ordinal=ordinal,
                    account_revision=account["revision"],
                    position_revision=position["revision"])
                if native_int(receipt.quantity_units) != quantity or \
                        receipt.position_state_hash != position["arithmetic_state_hash"]:
                    raise FinanceError("maintenance receipt must cover exact residual")
                intent = build_maintenance_intent(manifest, decision, receipt,
                    command["command_hash"])
                mandate = await reserve_maintenance_close(self, conn, scope,
                    manifest, run, account, command, receipt, intent,
                    inputs["policy"], epoch, now)
            else:
                if mandate.scope != scope or mandate.run_id != run_id or \
                        mandate.manifest_hash != manifest_hash or \
                        mandate.command_id != command_id:
                    raise FinanceError("maintenance retry changed its mandate")
            intent = await _prior_intent(conn, params, mandate)
        prepared = await self.prepare_order(intent, mandate.reservation_id,
            mandate.order_ordinal, worker_id=worker_id,
            command_id=f"maintenance:{command_id}:prepare")
        if prepared["orderId"] != mandate.maintenance_order_id:
            raise FinanceError("prepared maintenance order differs from mandate")
        return {"commandId": command_id, "status": "prepared",
                "orderId": prepared["orderId"], "orderOrdinal": mandate.order_ordinal,
                "intentId": mandate.intent_id,
                "reservationId": mandate.reservation_id,
                "maintenanceReceiptHash": mandate.receipt_hash}
