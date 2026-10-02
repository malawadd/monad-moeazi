"""Resume the exact selected owner close through the existing financial writer."""
from __future__ import annotations

from sqlalchemy import text

from .finance_contracts import FinanceError
from .lifecycle_maintenance_selection import select_maintenance_command
from .lifecycle_phase_dispatch import complete_idempotent_phase
from .lifecycle_phase_receipts import PhaseCommand
from .lifecycle_run_store import _run_params


async def process_maintenance_phase(repository, command: PhaseCommand,
                                     worker_id: str) -> dict:
    command.bind(command.scope, command.run_id, command.manifest_hash, "maintenance")
    selection = PhaseCommand(command.scope, command.run_id, command.manifest_hash,
        command.command_id, "maintenance_select", command.inputs)
    selected = await select_maintenance_command(repository, selection, worker_id)

    async def dispatch():
        if selected["skipped"]:
            return {"status": "idle", "commandId": None}
        scope, run_id = command.scope, command.run_id
        # A submission committed before its activity response was lost. Read that
        # exact identity rather than create another mandate or re-admit exposure.
        async with repository.finance.engine.connect() as conn:
            prior = (await conn.execute(text("""
                SELECT m.maintenance_order_id,m.receipt_hash FROM simulation_maintenance_reductions m
                JOIN simulation_orders o ON o.environment=m.environment AND o.scope_id=m.scope_id
                  AND o.strategy_account_id=m.strategy_account_id AND o.run_id=m.run_id
                  AND o.order_id=m.maintenance_order_id
                WHERE m.environment=:environment AND m.scope_id=:scope_id
                  AND m.strategy_account_id=:strategy_account_id AND m.run_id=:run_id
                  AND m.command_id=:command AND m.command_hash=:hash
                  AND o.permit_json->>'maintenance_receipt_hash'=m.receipt_hash
            """), {**_run_params(scope, run_id), "command": selected["commandId"],
                   "hash": selected["commandHash"]})).mappings().first()
        if prior is not None:
            return {"status": "submission_possible", "commandId": selected["commandId"],
                    "orderId": prior["maintenance_order_id"],
                    "maintenanceReceiptHash": prior["receipt_hash"]}
        issued = await repository.issue_maintenance_reduction(scope, run_id,
            command.manifest_hash, selected["commandId"], worker_id=worker_id)
        if issued.get("commandId") != selected["commandId"]:
            raise FinanceError("Maintenance writer returned another selected command")
        if issued["status"] in {"awaiting_evidence", "awaiting_finance"}:
            return issued
        if issued["status"] != "prepared":
            raise FinanceError("Maintenance writer returned an unknown state")
        started = await repository.start_order(scope, run_id, issued["orderId"],
                                                worker_id=worker_id)
        if started["permit"].maintenance_receipt_hash != issued["maintenanceReceiptHash"]:
            raise FinanceError("Maintenance submission changed its close mandate")
        return {"status": "submission_possible", "commandId": selected["commandId"],
                "orderId": issued["orderId"],
                "maintenanceReceiptHash": issued["maintenanceReceiptHash"]}

    return await complete_idempotent_phase(repository, command, worker_id, dispatch)
