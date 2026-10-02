"""Actual OS worker recovery with synthetic partial exposure; not full Q4 protection."""
import asyncio
import os

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from temporalio.client import Client

from moeazi_agent.simulation_dispatch import ensure_simulation_supervisor
from moeazi_agent.simulation_runtime_config import simulation_workflow_id
from moeazi_agent.simulation_workflow_contracts import SimulationControl
from stage3_process_harness import IdentityFixture, SimulationProcess
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_control_processing_postgres import submitted


async def snapshot(engine, run, order):
    async with engine.connect() as conn:
        row = (await conn.execute(text("""
            SELECT o.status,r.status AS hold_status,p.signed_exposure_units,
              p.pending_obligations,a.reconciliation_state,s.entries_stopped,
              (SELECT count(*) FROM simulation_event_journal_links l
                WHERE l.environment=o.environment AND l.scope_id=o.scope_id
                  AND l.strategy_account_id=o.strategy_account_id AND l.run_id=o.run_id) journals,
              (SELECT count(*) FROM simulation_order_events e
                WHERE e.environment=o.environment AND e.scope_id=o.scope_id
                  AND e.strategy_account_id=o.strategy_account_id AND e.run_id=o.run_id
                  AND e.kind='fill') fills
            FROM simulation_orders o JOIN finance_reservations r
              USING(environment,scope_id,strategy_account_id,reservation_id)
            JOIN finance_accounts a USING(environment,scope_id,strategy_account_id)
            JOIN simulation_runs s USING(environment,scope_id,strategy_account_id,run_id)
            LEFT JOIN simulation_positions p ON p.environment=o.environment
              AND p.scope_id=o.scope_id AND p.strategy_account_id=o.strategy_account_id
              AND p.run_id=o.run_id AND p.instrument_version_id=o.instrument_version_id
            WHERE o.environment=:environment AND o.scope_id=:scope_id
              AND o.strategy_account_id=:strategy_account_id AND o.run_id=:run_id
              AND o.order_id=:order
        """), {**run.scope.model_dump(), "run_id": run.run_id, "order": order})).mappings().one()
    return dict(row)


@pytest.mark.asyncio
async def test_partial_position_and_hold_survive_actual_worker_crash_then_cancel_recovery(monkeypatch):
    if os.getenv("MOEAZI_Q4_PROCESS_TEST") != "1":
        pytest.skip("explicit local actual-process qualification opt-in required")
    import test_lifecycle_preparation_postgres as fixture
    original = fixture.scenario
    monkeypatch.setattr(fixture, "scenario", lambda **values: original(
        **(values | {"depth_participation_bps": 50})))
    engine = create_async_engine(guarded_dsn())
    handle = None
    try:
        repo, run, order = await submitted(engine)
        await repo.finance.acquire_writer_epoch(run.scope, "stage2-verifier", lease_seconds=1)
        await asyncio.sleep(1.1)
        client = await Client.connect("127.0.0.1:7233", namespace="default")
        with IdentityFixture("verified-owner", {"scope": {"scopeId": run.scope.scope_id}}) as identity:
            with SimulationProcess(identity) as worker:
                await ensure_simulation_supervisor(client, run.scope, run.run_id, run.manifest_hash)
                handle = client.get_workflow_handle(simulation_workflow_id(run.scope, run.run_id))
                async with asyncio.timeout(40):
                    while True:
                        worker.check_alive()
                        state = await snapshot(engine, run, order)
                        if state["status"] == "partially_filled" and state["reconciliation_state"] == "clean":
                            break
                        await asyncio.sleep(0.2)
                assert int(state["signed_exposure_units"]) == 500_000
                assert state["fills"] == state["journals"] == 1
                assert state["hold_status"] == "submitted" and state["pending_obligations"]
                first_run = (await handle.describe()).run_id
                first_pid = worker.process.pid
                worker.crash()
                assert worker.process.poll() is not None
                for control in (SimulationControl(command_id="crash-stop", operation="stop_entries"),
                    SimulationControl(command_id="crash-cancel", operation="request_cancel", order_id=order)):
                    await repo.apply_control(run.scope, run.run_id, run.manifest_hash, control,
                        worker_id="api-while-worker-down", command_id=control.command_id)
                assert worker.start() != first_pid
                await handle.signal("wake")
                # The replacement must wait for the dead writer's actual lease;
                # no wall-clock edits or forced writer-epoch takeover.
                try:
                    async with asyncio.timeout(75):
                        while True:
                            worker.check_alive()
                            state = await snapshot(engine, run, order)
                            if state["status"] == "cancelled" and state["reconciliation_state"] == "clean":
                                break
                            await asyncio.sleep(0.25)
                except TimeoutError:
                    pytest.fail(f"Partial recovery incomplete: {state}; worker log: {worker.log_path}")
                assert int(state["signed_exposure_units"]) == 500_000
                assert state["fills"] == state["journals"] == 1
                assert state["hold_status"] == "submitted" and state["pending_obligations"]
                assert state["entries_stopped"] and identity.calls == 0
                assert (await handle.describe()).run_id == first_run
                assert (await handle.query("state"))["status"] != "completed_flat"
    finally:
        if handle:
            await handle.cancel()
        await engine.dispose()
