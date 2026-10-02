"""Q4 source-derived checkpoint must disagree with altered SQL projections."""
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.lifecycle_checkpoint_verify import verify_replay_checkpoint
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_postgres_atomic_fold import started


async def rows(conn, run):
    scope = run.scope.model_dump()
    account = (await conn.execute(text("""
        SELECT * FROM finance_accounts WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
    """), scope)).mappings().one()
    durable = (await conn.execute(text("""
        SELECT * FROM simulation_runs WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id
    """), scope | {"run_id": run.run_id})).mappings().one()
    return account, durable


@pytest.mark.asyncio
async def test_sql_checkpoint_uses_source_facts_not_current_balance_or_position_as_oracle():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, run, prepared, _ = await started(engine)
        await repo.fold_order_events(run.scope, run.run_id, prepared["orderId"],
            worker_id="stage2-verifier", command_id="checkpoint-source-fold")
        params = run.scope.model_dump() | {"run_id": run.run_id}
        async with engine.connect() as conn:
            account, durable = await rows(conn, run)
            oracle, facts = await verify_replay_checkpoint(
                conn, run.scope, run, durable, account)
            assert oracle.economic_count == 1 and len(facts) >= 2

        async with engine.connect() as conn:
            tx = await conn.begin()
            try:
                changed = await conn.execute(text("""
                    UPDATE finance_balances SET units=units+1
                    WHERE ctid IN (SELECT ctid FROM finance_balances
                      WHERE environment=:environment AND scope_id=:scope_id
                        AND strategy_account_id=:strategy_account_id
                        AND book='wallet' LIMIT 1)
                """), params)
                assert changed.rowcount == 1
                account, durable = await rows(conn, run)
                with pytest.raises(FinanceError, match="ledger|journal"):
                    await verify_replay_checkpoint(
                        conn, run.scope, run, durable, account)
            finally:
                await tx.rollback()

        async with engine.connect() as conn:
            tx = await conn.begin()
            try:
                await conn.execute(text("""
                    UPDATE simulation_positions
                    SET signed_exposure_units=signed_exposure_units+1
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id
                      AND run_id=:run_id
                """), params)
                account, durable = await rows(conn, run)
                with pytest.raises(FinanceError, match="position"):
                    await verify_replay_checkpoint(
                        conn, run.scope, run, durable, account)
            finally:
                await tx.rollback()

        async with engine.connect() as conn:
            account, durable = await rows(conn, run)
            recovered, _ = await verify_replay_checkpoint(
                conn, run.scope, run, durable, account)
            assert recovered.journal_root == oracle.journal_root
    finally:
        await engine.dispose()
