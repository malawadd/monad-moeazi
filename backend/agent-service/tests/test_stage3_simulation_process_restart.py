"""Real worker-process termination/restart on an empty unfunded Q4 account."""
import asyncio
import os

import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from temporalio.client import Client

from moeazi_agent.simulation_dispatch import ensure_simulation_supervisor
from moeazi_agent.simulation_runtime_config import simulation_workflow_id
from moeazi_agent.simulation_workflow_contracts import SimulationControl
from stage3_process_harness import IdentityFixture, SimulationProcess
from test_stage3_simulation_empty_run import guarded_dsn, setup


@pytest.mark.asyncio
async def test_empty_run_recovers_from_actual_process_termination_with_unchanged_history():
    if os.getenv("MOEAZI_Q4_PROCESS_TEST") != "1":
        pytest.skip("explicit local actual-process qualification opt-in required")
    engine = create_async_engine(guarded_dsn())
    handle = None
    try:
        finance, repo, run, _ = await setup(engine)
        await finance.acquire_writer_epoch(run.scope, "stage2-verifier", lease_seconds=1)
        await asyncio.sleep(1.1)
        client = await Client.connect("127.0.0.1:7233", namespace="default")
        context = {"scope": {"scopeId": run.scope.scope_id}}
        with IdentityFixture("kernel-owner", context) as identity:
            with SimulationProcess(identity) as worker:
                await ensure_simulation_supervisor(client, run.scope, run.run_id, run.manifest_hash)
                handle = client.get_workflow_handle(simulation_workflow_id(run.scope, run.run_id))
                async with asyncio.timeout(30):
                    while True:
                        worker.check_alive()
                        try:
                            status = await asyncio.wait_for(handle.query("state"), timeout=3)
                            if status["status"] == "registered":
                                break
                        except TimeoutError:
                            pass
                        await asyncio.sleep(0.1)
                first_run = (await handle.describe()).run_id
                first_pid = worker.process.pid
                worker.crash()
                assert worker.process.poll() is not None
                control = SimulationControl(command_id="process-stop", operation="stop_entries")
                await repo.apply_control(run.scope, run.run_id, run.manifest_hash, control,
                                        worker_id="api-while-worker-down", command_id=control.command_id)
                assert worker.start() != first_pid
                await handle.signal("wake")
                # The dead physical writer's real 30-second lease must expire;
                # this test does not patch time or take over its lease manually.
                result = await asyncio.wait_for(handle.result(), timeout=65)
                assert result["status"] == "completed_flat"
                assert (await handle.describe()).run_id == first_run
                assert identity.calls == 0  # Idle/protection supervision never polls product identity.
                assert not (await repo.read_run(run.scope, run.run_id, run.manifest_hash)).pending_obligations
    finally:
        if handle:
            await handle.cancel()
        await engine.dispose()
