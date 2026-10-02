"""Actual SQL067 checkpoint admission blocks incomplete source folds."""
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_postgres_atomic_fold import started


async def state(engine, run):
    params = run.scope.model_dump() | {"run_id": run.run_id}
    async with engine.connect() as conn:
        account = (await conn.execute(text("""
            SELECT revision,observation_snapshot_hash,reconciliation_state
            FROM finance_accounts WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
        """), params)).one()
        facts = (await conn.execute(text("""
            SELECT count(*) FROM simulation_order_events
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
        """), params)).scalar_one()
        derived = (await conn.execute(text("""
            SELECT count(*) FROM simulation_derived_snapshots
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
        """), params)).scalar_one()
    return tuple(account), facts, derived


@pytest.mark.asyncio
async def test_checkpoint_refuses_unfolded_due_facts_without_partial_source_commit():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, run, prepared, _ = await started(engine)
        before = await state(engine, run)
        assert before[1:] == (0, 0)
        with pytest.raises(FinanceError, match="folded"):
            await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
                run.manifest_hash, worker_id="stage2-verifier",
                command_id="checkpoint-before-fold")
        assert await state(engine, run) == before
        await repo.fold_order_events(run.scope, run.run_id, prepared["orderId"],
            worker_id="stage2-verifier", command_id="checkpoint-complete-fold")
        ready = await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier",
            command_id="checkpoint-after-fold")
        after = await state(engine, run)
        assert ready["duplicate"] is False
        assert ready["snapshotHash"] != run.account_snapshot_hash
        assert after[0][1] == ready["snapshotHash"]
        assert after[2] == 1 and after[1] >= 2
        again = await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier",
            command_id="checkpoint-after-fold")
        assert again["duplicate"] is True
        assert again["snapshotHash"] == ready["snapshotHash"]
        assert await state(engine, run) == after
    finally:
        await engine.dispose()
