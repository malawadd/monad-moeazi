"""One durable phase per Temporal advance, ordered by existing obligations."""
from __future__ import annotations

from .finance_contracts import FinanceScope
from .lifecycle_phase_dispatch import select_phase, complete_idempotent_phase
from .lifecycle_phase_receipts import PhaseCommand
from .lifecycle_maintenance_dispatch import process_maintenance_phase


async def advance_one_phase(repository, scope: FinanceScope, run_id: str,
                            manifest_hash: str, worker_id: str, command_id: str,
                            *, entries_inhibited: bool) -> bool:
    """Retries consume original responses, never another command's run revision."""
    def command(phase):
        inputs = {"entriesInhibited": entries_inhibited}
        if phase == "fold":
            inputs["foldScope"] = "all_due_run_events"
        return PhaseCommand(scope, run_id, manifest_hash, command_id, phase, inputs)

    control = await repository.process_run_controls(scope, run_id, manifest_hash,
        worker_id=worker_id, phase_command=command("controls"))
    if control["dispatchedCount"] or control["resolvedCount"]:
        return True

    fold_command = command("fold")
    folded, order_id = await select_phase(repository, fold_command, worker_id)
    if folded is None:
        folded = await repository.fold_order_events(scope, run_id, order_id,
            worker_id=worker_id, command_id=f"{command_id}:fold",
            phase_command=fold_command)
    if folded.get("foldedCount", 0):
        return True

    checkpoint_command = command("checkpoint")
    checkpoint, _ = await select_phase(repository, checkpoint_command, worker_id)
    if checkpoint is None:
        checkpoint = await repository.reconcile_replay_checkpoint(scope, run_id,
            manifest_hash, worker_id=worker_id, command_id=f"{command_id}:checkpoint",
            phase_command=checkpoint_command)
    if not checkpoint.get("skipped") and not checkpoint["duplicate"]:
        return True

    settlement = await repository.settle_replay_reservations(scope, run_id, manifest_hash,
        worker_id=worker_id, command_id=f"{command_id}:settlement",
        phase_command=command("settlement"))
    if settlement["settled"]:
        return True

    resolution = await repository.resolve_flat_positions(scope, run_id, manifest_hash,
        worker_id=worker_id, command_id=f"{command_id}:resolution",
        phase_command=command("resolution"))
    if resolution["resolved"]:
        return True

    protection = await repository.process_protection_deadlines(scope, run_id, manifest_hash,
        worker_id=worker_id, phase_command=command("protection"))
    if protection["escalatedCount"]:
        return True

    maintenance = await process_maintenance_phase(repository, command("maintenance"), worker_id)
    if maintenance["status"] == "submission_possible":
        return True

    entry_command = command("entry")
    outcome, _ = await select_phase(repository, entry_command, worker_id)
    if outcome is None:
        outcome = await complete_idempotent_phase(repository, entry_command, worker_id,
            lambda: repository.process_next_entry_request(scope, run_id, manifest_hash,
                worker_id, f"{command_id}:entry"))
    if outcome.get("status") in {"submission_possible", "completed", "rejected"}:
        return True
    # Awaiting approval/evidence cannot suppress existing source obligations.
    # This final phase already stores its exact cursor pair atomically in SQL069.
    cursor = await repository.advance_replay_cursor(scope, run_id, manifest_hash,
        worker_id=worker_id, command_id=f"{command_id}:cursor")
    return cursor["advanced"]
