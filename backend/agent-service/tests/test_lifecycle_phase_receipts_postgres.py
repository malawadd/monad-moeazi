"""A recovered advance command returns its exact committed financial substep."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.lifecycle_phase_receipts import PhaseCommand
from test_lifecycle_preparation_postgres import guarded_dsn, setup


@pytest.mark.asyncio
async def test_fold_and_checkpoint_phase_results_are_committed_with_effects():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, _, run, intent, reserved = await setup(engine)
        await repo.persist_intent(intent)
        prepared = await repo.prepare_order(intent, reserved["reservationId"], 1,
            worker_id="stage2-verifier", command_id="prepare-phase")
        approval = await repo.record_simulation_approval(run.scope, run.run_id,
            run.manifest_hash, intent.intent_id, prepared["normalizedPayloadHash"],
            "verified-owner", datetime.now(timezone.utc) + timedelta(seconds=30),
            "approve-phase")
        await repo.start_order(run.scope, run.run_id, prepared["orderId"],
            worker_id="stage2-verifier",
            approval_receipt_hash=approval["approvalReceiptHash"])
        async with engine.begin() as conn:
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**run.scope.model_dump(), "run_id": run.run_id,
                   "cursor": run.scenario.simulation_end_at})
        inputs = {"entriesInhibited": False, "foldScope": "all_due_run_events"}
        fold_phase = PhaseCommand(run.scope, run.run_id, run.manifest_hash,
                                  "advance-phase", "fold", inputs)
        first = await repo.fold_order_events(run.scope, run.run_id,
            prepared["orderId"], worker_id="stage2-verifier", command_id="fold-phase",
            phase_command=fold_phase)
        retry = await repo.fold_order_events(run.scope, run.run_id,
            prepared["orderId"], worker_id="stage2-verifier", command_id="fold-phase",
            phase_command=fold_phase)
        assert first == retry and first["foldedCount"] > 0
        independently_duplicate = await repo.fold_order_events(run.scope, run.run_id,
            prepared["orderId"], worker_id="stage2-verifier", command_id="fold-next")
        assert independently_duplicate["foldedCount"] == 0
        checkpoint_phase = PhaseCommand(run.scope, run.run_id, run.manifest_hash,
                                        "advance-phase", "checkpoint", inputs)
        reconciled = await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id="checkpoint-phase",
            phase_command=checkpoint_phase)
        recovered = await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id="checkpoint-phase",
            phase_command=checkpoint_phase)
        assert recovered == reconciled and reconciled["duplicate"] is False
        direct = await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id="checkpoint-next")
        assert direct["duplicate"] is True
    finally:
        await engine.dispose()
