"""Actual SQL cancellation dispatch; no settlement or protection qualification."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_cancel_receipts import load_cancel_dispatches
from moeazi_agent.lifecycle_control_processing import LifecycleControlProcessingMixin
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.simulation_workflow_contracts import SimulationControl
from test_lifecycle_preparation_postgres import guarded_dsn, setup
from test_stage3_simulation_database_role import qualification


async def submitted(engine):
    repo, finance, run, intent, reserved = await setup(engine)
    await repo.persist_intent(intent)
    prepared = await repo.prepare_order(intent, reserved["reservationId"], 1,
        worker_id="stage2-verifier", command_id="control-prepare")
    approval = await repo.record_simulation_approval(run.scope, run.run_id,
        run.manifest_hash, intent.intent_id, prepared["normalizedPayloadHash"],
        "verified-owner", datetime.now(timezone.utc) + timedelta(seconds=45), "control-approve")
    await repo.start_order(run.scope, run.run_id, prepared["orderId"],
        worker_id="stage2-verifier", approval_receipt_hash=approval["approvalReceiptHash"])
    return repo, run, prepared["orderId"]


async def process(repo, run):
    return await LifecycleControlProcessingMixin.process_run_controls(repo, run.scope,
        run.run_id, run.manifest_hash, worker_id="stage2-verifier")


@pytest.mark.asyncio
async def test_cancel_commands_share_one_immutable_dispatch_without_releasing_hold():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, order = await submitted(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        async with narrow.connect() as conn:
            revision = (await conn.execute(text("""
                SELECT revision FROM finance_accounts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), params)).scalar_one()
        for command_id in ("cancel-first", "cancel-again"):
            command = SimulationControl(command_id=command_id, operation="request_cancel", order_id=order)
            await repo.apply_control(run.scope, run.run_id, run.manifest_hash, command,
                worker_id="api-fixture", command_id=command_id)
        first = await process(repo, run)
        assert first["dispatchedCount"] == 1 and first["resolvedCount"] == 0
        repeat = await process(repo, run)
        assert repeat["dispatchedCount"] == repeat["resolvedCount"] == 0
        async with narrow.connect() as conn:
            receipts = await load_cancel_dispatches(conn, run)
            current = (await conn.execute(text("""
                SELECT revision FROM finance_accounts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), params)).scalar_one()
            hold = (await conn.execute(text("""
                SELECT r.status FROM simulation_orders o JOIN finance_reservations r
                  USING(environment,scope_id,strategy_account_id,reservation_id)
                WHERE o.environment=:environment AND o.scope_id=:scope_id
                  AND o.strategy_account_id=:strategy_account_id AND o.run_id=:run_id
                  AND o.order_id=:order
            """), {**params, "order": order})).scalar_one()
        assert len(receipts) == 1 and receipts[0].commandId == "cancel-first"
        assert receipts[0].requestedCursor == run.scenario.simulation_cursor_at
        assert receipts[0].effectiveCursor == run.scenario.simulation_cursor_at + timedelta(
            milliseconds=run.scenario.latency_ms + run.scenario.cancel_latency_ms)
        assert current == revision and hold == "submitted"
        with pytest.raises(FinanceError):
            await LifecycleControlProcessingMixin.process_run_controls(repo, run.scope,
                run.run_id, "f" * 64, worker_id="stage2-verifier")
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_due_full_fill_prevents_dispatch_even_before_financial_fold():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, order = await submitted(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        # Inject the crash boundary after replay clock advancement but before
        # source/journal fold. The source facts themselves still come from replay.
        async with broad.begin() as conn:
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**params, "cursor": run.scenario.simulation_cursor_at +
                    timedelta(milliseconds=run.scenario.latency_ms)})
        command = SimulationControl(command_id="late-cancel", operation="request_cancel", order_id=order)
        await repo.apply_control(run.scope, run.run_id, run.manifest_hash, command,
            worker_id="api-fixture", command_id=command.command_id)
        result = await process(repo, run)
        assert result["dispatchedCount"] == result["resolvedCount"] == 0
        assert result["pendingInBatch"] == 1
        async with narrow.connect() as conn:
            assert await load_cancel_dispatches(conn, run) == ()
            events = (await conn.execute(text("""
                SELECT kind FROM simulation_order_events WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id ORDER BY simulation_cursor_at,sequence
            """), params)).scalars().all()
            folded = (await conn.execute(text("""
                SELECT count(*) FROM simulation_event_folds WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id
            """), params)).scalar_one()
        assert events == ["accepted", "fill"] and folded == 0
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("partial", [False, True])
async def test_dynamic_cancel_source_folds_once_and_never_releases_capacity_itself(monkeypatch, partial):
    if partial:
        import test_lifecycle_preparation_postgres as fixture
        original = fixture.scenario
        monkeypatch.setattr(fixture, "scenario", lambda **values: original(
            **(values | {"depth_participation_bps": 50})))
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, order = await submitted(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        params = {**run.scope.model_dump(), "run_id": run.run_id, "order": order}
        command = SimulationControl(command_id="source-cancel", operation="request_cancel", order_id=order)
        await repo.apply_control(run.scope, run.run_id, run.manifest_hash, command,
            worker_id="api-fixture", command_id=command.command_id)
        assert (await process(repo, run))["dispatchedCount"] == 1
        early = await repo.fold_order_events(run.scope, run.run_id, order,
            worker_id="stage2-verifier", command_id="early-cancel-request")
        assert early["foldedCount"] == 1
        async with narrow.connect() as conn:
            dispatch, = await load_cancel_dispatches(conn, run)
        async with broad.begin() as conn:
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**params, "cursor": dispatch.effectiveCursor})
        folded = await repo.fold_order_events(run.scope, run.run_id, order,
            worker_id="stage2-verifier", command_id="dynamic-cancel-fold")
        assert folded["foldedCount"] == (3 if partial else 2)
        duplicate = await repo.fold_order_events(run.scope, run.run_id, order,
            worker_id="stage2-verifier", command_id="dynamic-cancel-fold")
        assert duplicate["foldedCount"] == 0
        async with narrow.connect() as conn:
            state = (await conn.execute(text("""
                SELECT o.status,o.cumulative_filled_units,r.status AS hold_status
                FROM simulation_orders o JOIN finance_reservations r
                  USING(environment,scope_id,strategy_account_id,reservation_id)
                WHERE o.environment=:environment AND o.scope_id=:scope_id
                  AND o.strategy_account_id=:strategy_account_id AND o.run_id=:run_id
                  AND o.order_id=:order
            """), params)).mappings().one()
        assert state["status"] == ("cancelled" if partial else "filled")
        assert int(state["cumulative_filled_units"]) == (500_000 if partial else 1_000_000)
        assert state["hold_status"] == "submitted"
        # Terminal source cancellation alone is not financial reconciliation.
        assert (await process(repo, run))["resolvedCount"] == 0
    finally:
        await narrow.dispose()
        await broad.dispose()
