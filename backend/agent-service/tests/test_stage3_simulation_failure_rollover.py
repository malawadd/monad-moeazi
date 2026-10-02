"""Real local Temporal recovery-history bound; synthetic activities, not Q4."""
import asyncio
from uuid import uuid4

import pytest
from temporalio import activity
from temporalio.exceptions import ApplicationError

from moeazi_agent.simulation_workflow import SimulationSupervisorWorkflow
from test_stage3_simulation_temporal import binding, connect, worker


class FailingActivities:
    def __init__(self):
        self.fail = True
        self.advances = []
        self.controls = []
        self.successes = []

    @activity.defn(name="advance_simulation_run_v1")
    async def advance(self, payload: dict) -> dict:
        self.advances.append(payload)
        if self.fail:
            raise ApplicationError("Synthetic persistent outage", non_retryable=True)
        self.successes.append(payload)
        return {"schema_version": 1, "run_id": "kernel-run",
                "status": "completed_flat", "cursor_sequence": 0,
                "projection_revision": 1, "pending_obligations": False,
                "next_action": "completed", "next_wake_delay_ms": None}

    @activity.defn(name="apply_simulation_control_v1")
    async def control(self, payload: dict) -> dict:
        self.controls.append(payload)
        if self.fail:
            return {"status": "unknown"}
        return {"commandId": payload["control"]["command_id"],
                "operation": payload["control"]["operation"],
                "outcome": "applied", "projectionRevision": 1}


@pytest.mark.asyncio
async def test_persistent_failures_roll_over_without_new_economic_command_or_lost_stop():
    client = await connect()
    queue = f"q4-kernel-failed-rollover-{uuid4()}"
    activities = FailingActivities()
    stop = {"command_id": "durable-stop", "operation": "stop_entries"}
    async with worker(client, queue, activities):
        handle = await client.start_workflow(SimulationSupervisorWorkflow.run,
            {**binding(), "pending_controls": [stop]}, id=queue, task_queue=queue)
        try:
            async with asyncio.timeout(55):
                while (await handle.describe()).run_id == handle.first_execution_run_id:
                    await handle.signal("wake")
                    await asyncio.sleep(0.03)
            assert len(activities.advances) >= 128
            assert {p["command_id"] for p in activities.advances} == {"advance:0"}
            assert all(p["entries_inhibited"] for p in activities.advances)
            assert {p["control"]["command_id"] for p in activities.controls} == {"durable-stop"}
            state = await handle.query("state")
            assert state["pending_controls"] == 1
            activities.fail = False
            await handle.signal("wake")
            result = await asyncio.wait_for(handle.result(), timeout=15)
            assert result["status"] == "completed_flat"
            assert result["pending_controls"] == 0
            # Recovery can occur between a failed control and its advance. That
            # successful protection-only advance legitimately consumes a sequence
            # before the next successful control consumes its own sequence.
            assert activities.advances[-1]["command_id"] == f"advance:{len(activities.successes)}"
            assert activities.advances[-1]["entries_inhibited"] is False
        finally:
            await handle.cancel()
