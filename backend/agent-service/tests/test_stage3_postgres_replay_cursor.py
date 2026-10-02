"""SQL069 cursor steps use modeled facts and fenced immutable command receipts."""
from datetime import timedelta
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_control_processing_postgres import submitted
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
async def test_cursor_advances_only_next_modeled_fact_then_waits_for_fold_and_checkpoint():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, order = await submitted(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow),
                                             simulator=simulate_order)
        first = await repo.advance_replay_cursor(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id="cursor-first")
        assert first["previousCursorAt"] == run.scenario.simulation_cursor_at
        assert first["nextCursorAt"] == run.scenario.simulation_cursor_at + \
            timedelta(milliseconds=run.scenario.latency_ms)
        assert first["advanced"] is True and first["duplicate"] is False
        assert await repo.advance_replay_cursor(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier",
            command_id="cursor-first") == (first | {"duplicate": True})
        params = run.scope.model_dump() | {"run_id": run.run_id}
        async with narrow.connect() as conn:
            tx = await conn.begin()
            try:
                with pytest.raises(Exception):
                    async with conn.begin_nested():
                        await conn.execute(text("""
                            INSERT INTO simulation_replay_cursor_claims(
                              environment,scope_id,strategy_account_id,run_id,
                              command_id,manifest_hash,previous_cursor_at,
                              next_cursor_at,source_root,account_snapshot_hash,
                              projection_revision,result_hash)
                            SELECT environment,scope_id,strategy_account_id,run_id,
                              'forged-cursor',manifest_hash,:current,:current,
                              source_root,:foreign,projection_revision,result_hash
                            FROM simulation_replay_cursor_claims
                            WHERE environment=:environment AND scope_id=:scope_id
                              AND strategy_account_id=:strategy_account_id
                              AND run_id=:run_id AND command_id='cursor-first'
                        """), params | {"current": first["nextCursorAt"],
                                       "foreign": "f" * 64})
                for operation in ("UPDATE", "DELETE"):
                    statement = ("UPDATE simulation_replay_cursor_claims "
                        "SET source_root=:changed" if operation == "UPDATE" else
                        "DELETE FROM simulation_replay_cursor_claims")
                    with pytest.raises(Exception):
                        async with conn.begin_nested():
                            await conn.execute(text(statement + """
                                WHERE environment=:environment AND scope_id=:scope_id
                                  AND strategy_account_id=:strategy_account_id
                                  AND run_id=:run_id AND command_id='cursor-first'
                            """), params | {"changed": "e" * 64})
            finally:
                await tx.rollback()
        with pytest.raises(FinanceError, match="folded"):
            await repo.advance_replay_cursor(run.scope, run.run_id,
                run.manifest_hash, worker_id="stage2-verifier",
                command_id="cursor-second")
        async with narrow.connect() as conn:
            claim_count = (await conn.execute(text("""
                SELECT count(*) FROM simulation_replay_cursor_claims
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
            source_count = (await conn.execute(text("""
                SELECT count(*) FROM simulation_order_events
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
        assert (claim_count, source_count) == (1, 0)
        await repo.fold_order_events(run.scope, run.run_id, order,
            worker_id="stage2-verifier", command_id="cursor-fold")
        with pytest.raises(FinanceError, match="checkpoint|unknown"):
            await repo.advance_replay_cursor(run.scope, run.run_id,
                run.manifest_hash, worker_id="stage2-verifier",
                command_id="cursor-before-reconcile")
        checkpoint = await repo.reconcile_replay_checkpoint(
            run.scope, run.run_id, run.manifest_hash,
            worker_id="stage2-verifier", command_id="cursor-reconcile")
        assert checkpoint["snapshotHash"] != run.account_snapshot_hash
        after = await repo.advance_replay_cursor(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id="cursor-after")
        assert after["previousCursorAt"] == first["nextCursorAt"]
        assert after["nextCursorAt"] >= after["previousCursorAt"]
    finally:
        await narrow.dispose()
        await broad.dispose()
