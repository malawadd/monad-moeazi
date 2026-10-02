"""Durably select one authenticated close without changing execution authority."""
from __future__ import annotations

from sqlalchemy import text

from .finance_contracts import FinanceError
from .lifecycle_phase_receipts import PhaseCommand, load_phase_receipt, store_phase_receipt
from .lifecycle_run_store import _run_params


async def select_maintenance_command(repository, command: PhaseCommand,
                                     worker_id: str) -> dict:
    """Persist selection, including no-op, before any separate financial effect.

    Submission excludes a close from new selections. Recovery of the original
    advance still receives its original selection and uses exact idempotent APIs.
    This receipt does not authorize a hold, preparation or submission by itself.
    """
    command.bind(command.scope, command.run_id, command.manifest_hash,
                 "maintenance_select")
    epoch = await repository.finance.acquire_writer_epoch(command.scope, worker_id)
    params = _run_params(command.scope, command.run_id)
    async with repository.finance.engine.begin() as conn:
        account = await repository.finance._lock(conn, command.scope)
        run = await repository._run(conn, command.scope, command.run_id, lock=True)
        await repository.finance._writer(conn, account, epoch)
        if run["manifest_hash"] != command.manifest_hash:
            raise FinanceError("Maintenance selection manifest differs")
        prior = await load_phase_receipt(conn, command)
        if prior is not None:
            return prior
        row = (await conn.execute(text("""
            SELECT c.command_id,c.command_hash,c.target_id
            FROM simulation_commands c
            WHERE c.environment=:environment AND c.scope_id=:scope_id
              AND c.strategy_account_id=:strategy_account_id AND c.run_id=:run_id
              AND c.operation='request_close' AND c.outcome='applied'
              AND c.requested_by_subject=:owner
              AND NOT EXISTS (SELECT 1 FROM simulation_control_processing p
                WHERE p.environment=c.environment AND p.scope_id=c.scope_id
                  AND p.strategy_account_id=c.strategy_account_id AND p.run_id=c.run_id
                  AND p.command_id=c.command_id AND p.processing_kind='resolved')
              AND NOT EXISTS (SELECT 1 FROM simulation_maintenance_reductions m
                JOIN simulation_orders o ON o.environment=m.environment
                  AND o.scope_id=m.scope_id AND o.strategy_account_id=m.strategy_account_id
                  AND o.run_id=m.run_id AND o.order_id=m.maintenance_order_id
                WHERE m.environment=c.environment AND m.scope_id=c.scope_id
                  AND m.strategy_account_id=c.strategy_account_id AND m.run_id=c.run_id
                  AND m.command_id=c.command_id)
            ORDER BY c.created_at,c.command_id LIMIT 1
        """), {**params, "owner": run["created_by_subject"]})).mappings().first()
        result = ({"commandId": row["command_id"], "commandHash": row["command_hash"],
                   "instrumentVersionId": row["target_id"], "skipped": False}
                  if row is not None else {"commandId": None, "skipped": True})
        return await store_phase_receipt(conn, command, result)
