"""Real narrow-role SQL phase response loss; no final settlement qualification."""
from datetime import timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent import lifecycle_advance, lifecycle_control_processing
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_phase_receipts import PhaseCommand
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.simulation_workflow_contracts import SimulationControl
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_control_processing_postgres import submitted
from test_stage3_simulation_database_role import qualification


def phase(run, command):
    return PhaseCommand(run.scope, run.run_id, run.manifest_hash, command, "controls",
                        {"entriesInhibited": False})


@pytest.mark.asyncio
async def test_noop_control_receipt_cannot_consume_a_later_cancellation():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, order = await submitted(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        first = await repo.process_run_controls(run.scope, run.run_id, run.manifest_hash,
            worker_id="stage2-verifier", phase_command=phase(run, "original"))
        assert first["dispatchedCount"] == first["resolvedCount"] == 0
        cancel = SimulationControl(command_id="later-cancel", operation="request_cancel", order_id=order)
        await repo.apply_control(run.scope, run.run_id, run.manifest_hash, cancel,
            worker_id="api-fixture", command_id=cancel.command_id)
        assert await repo.process_run_controls(run.scope, run.run_id, run.manifest_hash,
            worker_id="stage2-verifier", phase_command=phase(run, "original")) == first
        current = await repo.process_run_controls(run.scope, run.run_id, run.manifest_hash,
            worker_id="stage2-verifier", phase_command=phase(run, "next"))
        assert current["dispatchedCount"] == 1
        assert await repo.process_run_controls(run.scope, run.run_id, run.manifest_hash,
            worker_id="stage2-verifier", phase_command=phase(run, "next")) == current
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_cancel_phase_and_receipt_rollback_together(monkeypatch):
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, order = await submitted(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        cancel = SimulationControl(command_id="rollback-cancel", operation="request_cancel", order_id=order)
        await repo.apply_control(run.scope, run.run_id, run.manifest_hash, cancel,
            worker_id="api-fixture", command_id=cancel.command_id)
        real_store = lifecycle_control_processing.store_phase_receipt

        async def crash_after_receipt(*args):
            await real_store(*args)
            raise ConnectionError("injected crash after receipt before transaction commit")

        monkeypatch.setattr(lifecycle_control_processing, "store_phase_receipt", crash_after_receipt)
        with pytest.raises(ConnectionError, match="injected crash"):
            await repo.process_run_controls(run.scope, run.run_id, run.manifest_hash,
                worker_id="stage2-verifier", phase_command=phase(run, "atomic-cancel"))
        async with narrow.connect() as conn:
            params = {**run.scope.model_dump(), "run_id": run.run_id}
            for table in ("simulation_control_processing", "simulation_phase_receipts"):
                count = (await conn.execute(text(f"""
                    SELECT count(*) FROM {table} WHERE environment=:environment
                      AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                      AND run_id=:run_id
                """), params)).scalar_one()
                assert count == 0
        monkeypatch.setattr(lifecycle_control_processing, "store_phase_receipt", real_store)
        recovered = await repo.process_run_controls(run.scope, run.run_id, run.manifest_hash,
            worker_id="stage2-verifier", phase_command=phase(run, "atomic-cancel"))
        assert recovered["dispatchedCount"] == 1
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_lost_advance_response_repeats_fold_not_next_financial_phase(monkeypatch):
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, _ = await submitted(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        async with broad.begin() as conn:
            # Fault fixture selects a due source boundary; economics still come
            # exclusively from the frozen dataset and simulated order permit.
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**params, "cursor": run.scenario.simulation_cursor_at +
                    timedelta(milliseconds=run.scenario.latency_ms)})
        real_phase = lifecycle_advance.advance_one_phase

        async def lose_response(*args, **kwargs):
            assert await real_phase(*args, **kwargs)
            raise ConnectionError("injected loss after committed fold, before advance response")

        monkeypatch.setattr(lifecycle_advance, "advance_one_phase", lose_response)
        with pytest.raises(ConnectionError, match="injected loss"):
            await repo.advance_run(run.scope, run.run_id, run.manifest_hash,
                "stage2-verifier", "lost-fold")
        async with narrow.connect() as conn:
            before = (await conn.execute(text("""
                SELECT revision,observation_snapshot_hash,reconciliation_state
                FROM finance_accounts WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), params)).mappings().one()
        assert before["reconciliation_state"] != "clean"
        stop = SimulationControl(command_id="stop-during-retry", operation="stop_entries")
        await repo.apply_control(run.scope, run.run_id, run.manifest_hash, stop,
            worker_id="api-fixture", command_id=stop.command_id)
        monkeypatch.setattr(lifecycle_advance, "advance_one_phase", real_phase)
        recovered = await repo.advance_run(run.scope, run.run_id, run.manifest_hash,
            "stage2-verifier", "lost-fold")
        assert recovered.next_action == "advance"
        assert await repo.advance_run(run.scope, run.run_id, run.manifest_hash,
            "stage2-verifier", "lost-fold") == recovered
        async with narrow.connect() as conn:
            after = (await conn.execute(text("""
                SELECT revision,observation_snapshot_hash,reconciliation_state
                FROM finance_accounts WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), params)).mappings().one()
            kinds = (await conn.execute(text("""
                SELECT phase FROM simulation_phase_receipts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND command_id='lost-fold' ORDER BY phase
            """), params)).scalars().all()
            count = (await conn.execute(text("""
                SELECT count(*) FROM simulation_event_journal_links WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
        assert dict(after) == dict(before)
        assert kinds == ["controls", "fold"] and count == 1
    finally:
        await narrow.dispose()
        await broad.dispose()
