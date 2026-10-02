"""A phase receipt and its source, journal, or checkpoint effects commit together."""
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent import lifecycle_checkpoint_store, lifecycle_event_fold
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_phase_receipts import PhaseCommand
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_postgres_atomic_fold import started, state
from test_stage3_simulation_database_role import qualification


async def _counts(engine, run, command):
    params = {**run.scope.model_dump(), "run_id": run.run_id, "command": command}
    async with engine.connect() as conn:
        account = (await conn.execute(text("""
            SELECT revision,reconciliation_state,observation_snapshot_hash
            FROM finance_accounts WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
        """), params)).mappings().one()
        counts = {}
        for name, table, condition in (
            ("derived", "simulation_derived_snapshots", "run_id=:run_id"),
            ("checkpoints", "finance_reconciliation_checkpoints", "true"),
            ("outbox", "finance_outbox", "true"),
            ("receipts", "simulation_phase_receipts",
             "run_id=:run_id AND command_id=:command"),
        ):
            counts[name] = (await conn.execute(text(f"""
                SELECT count(*) FROM {table} WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND {condition}
            """), params)).scalar_one()
    return dict(account), counts


def _inject_after_receipt(monkeypatch, module):
    original = module.store_phase_receipt

    async def fail_after_insert(conn, command, result):
        await original(conn, command, result)
        raise RuntimeError("injected loss after phase receipt insert")

    monkeypatch.setattr(module, "store_phase_receipt", fail_after_insert)
    return original


@pytest.mark.asyncio
async def test_fold_receipt_failure_rolls_back_exact_journal_position_and_fact(monkeypatch):
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, prepared, _ = await started(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        key = f"fold-atomic-{uuid4()}"
        phase = PhaseCommand(run.scope, run.run_id, run.manifest_hash, key,
                             "fold", {"foldScope": "all_due_run_events"})
        before = await state(broad, run, prepared["orderId"])
        initial = await _counts(broad, run, key)
        original = _inject_after_receipt(monkeypatch, lifecycle_event_fold)
        with pytest.raises(RuntimeError, match="after phase receipt"):
            await repo.fold_order_events(run.scope, run.run_id, prepared["orderId"],
                worker_id="stage2-verifier", command_id=key, phase_command=phase)
        assert await state(broad, run, prepared["orderId"]) == before
        assert await _counts(broad, run, key) == initial
        monkeypatch.setattr(lifecycle_event_fold, "store_phase_receipt", original)
        committed = await repo.fold_order_events(run.scope, run.run_id,
            prepared["orderId"], worker_id="stage2-verifier", command_id=key,
            phase_command=phase)
        assert committed["foldedCount"] >= 2
        after = await _counts(broad, run, key)
        assert after[1]["receipts"] == initial[1]["receipts"] + 1
        assert await repo.fold_order_events(run.scope, run.run_id,
            prepared["orderId"], worker_id="stage2-verifier", command_id=key,
            phase_command=phase) == committed
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_checkpoint_receipt_failure_rolls_back_derived_finance_checkpoint_and_outbox(monkeypatch):
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, prepared, _ = await started(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        await repo.fold_order_events(run.scope, run.run_id, prepared["orderId"],
            worker_id="stage2-verifier", command_id=f"precheck-fold-{uuid4()}")
        key = f"checkpoint-atomic-{uuid4()}"
        phase = PhaseCommand(run.scope, run.run_id, run.manifest_hash, key,
                             "checkpoint", {"source": "all_due_run_events"})
        before = await _counts(broad, run, key)
        original = _inject_after_receipt(monkeypatch, lifecycle_checkpoint_store)
        with pytest.raises(RuntimeError, match="after phase receipt"):
            await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
                run.manifest_hash, worker_id="stage2-verifier", command_id=key,
                phase_command=phase)
        assert await _counts(broad, run, key) == before
        monkeypatch.setattr(lifecycle_checkpoint_store, "store_phase_receipt", original)
        committed = await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id=key,
            phase_command=phase)
        assert not committed["duplicate"]
        after = await _counts(broad, run, key)
        for field in ("derived", "checkpoints", "outbox", "receipts"):
            assert after[1][field] == before[1][field] + 1
        assert await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id=key,
            phase_command=phase) == committed
    finally:
        await narrow.dispose()
        await broad.dispose()
