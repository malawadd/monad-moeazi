"""Durable no-op selection and receipts around already-idempotent entry work."""
from __future__ import annotations

from sqlalchemy import text

from .finance_contracts import FinanceError
from .lifecycle_phase_receipts import PhaseCommand, load_phase_receipt, store_phase_receipt
from .lifecycle_run_store import _run_params


async def select_phase(repository, command: PhaseCommand, worker_id: str):
    """Return (original outcome, selected order hint). Persist skipped phases.

    Effectful fold/checkpoint phases record their response inside their own
    transaction. Selection itself never proves that such a phase completed.
    """
    scope = command.scope
    epoch = await repository.finance.acquire_writer_epoch(scope, worker_id)
    params = _run_params(scope, command.run_id)
    async with repository.finance.engine.begin() as conn:
        account = await repository.finance._lock(conn, scope)
        run = await repository._run(conn, scope, command.run_id, lock=True)
        await repository.finance._writer(conn, account, epoch)
        if run["manifest_hash"] != command.manifest_hash:
            raise FinanceError("Phase selection manifest differs")
        prior = await load_phase_receipt(conn, command)
        if prior is not None:
            return prior, None
        selected = None
        if command.phase == "fold":
            selected = (await conn.execute(text("""
                SELECT order_id FROM simulation_orders WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id ORDER BY order_ordinal LIMIT 1
            """), params)).scalar_one_or_none()
            eligible = selected is not None
        elif command.phase == "checkpoint":
            eligible = (await conn.execute(text("""
                SELECT EXISTS(SELECT 1 FROM simulation_event_folds
                  WHERE environment=:environment AND scope_id=:scope_id
                    AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                    AND event_kind IN ('fill','funding'))
            """), params)).scalar_one()
        elif command.phase == "entry":
            eligible = False
            if not command.inputs["entriesInhibited"] and repository.entry_authorizer is not None:
                eligible = (await conn.execute(text("""
                    SELECT EXISTS(SELECT 1 FROM simulation_entry_requests
                      WHERE environment=:environment AND scope_id=:scope_id
                        AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                        AND status IN ('queued','awaiting_evidence','awaiting_finance',
                                       'awaiting_approval','prepared'))
                """), params)).scalar_one()
        else:
            raise FinanceError("Unsupported phase selection")
        if not eligible:
            return await store_phase_receipt(conn, command, {"skipped": True}), None
        return None, selected


async def complete_idempotent_phase(repository, command: PhaseCommand,
                                    worker_id: str, operation) -> dict:
    """Entry preserves its own request/command identity before this receipt.

    No later phase is invoked until this response is durable. A crash beforehand
    retries that SAME operation. This wrapper does not make arbitrary work atomic.
    """
    scope = command.scope
    async with repository.finance.engine.connect() as conn:
        prior = await load_phase_receipt(conn, command)
    if prior is not None:
        return prior
    result = await operation()
    epoch = await repository.finance.acquire_writer_epoch(scope, worker_id)
    async with repository.finance.engine.begin() as conn:
        account = await repository.finance._lock(conn, scope)
        run = await repository._run(conn, scope, command.run_id, lock=True)
        await repository.finance._writer(conn, account, epoch)
        if run["manifest_hash"] != command.manifest_hash:
            raise FinanceError("Phase completion manifest differs")
        prior = await load_phase_receipt(conn, command)
        if prior is not None:
            return prior
        return await store_phase_receipt(conn, command, result)
