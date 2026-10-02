"""Opt-in real local Temporal kernel tests with synthetic activity state, NOT Q4.

Run with MOEAZI_Q4_TEMPORAL_ADDRESS=127.0.0.1:7233. No finance, providers or venue
clients are loaded; full Q4 separately requires the durable financial repository.
"""
import asyncio
import os
from uuid import uuid4

import pytest
from temporalio import activity
from temporalio.client import Client
from temporalio.exceptions import ApplicationError
from temporalio.worker import Worker

from moeazi_agent.simulation_workflow import SimulationSupervisorWorkflow


def binding():
    return {"scope": {"environment": "experiment", "scope_id": "kernel-spec",
                       "strategy_account_id": "kernel-account"},
            "run_id": "kernel-run", "manifest_hash": "a" * 64}


class KernelActivities:
    def __init__(self, *, rollover=False, fail_control=False, lost_result=False, unknown_control=False):
        self.calls = []
        self.controls = []
        self.rollover = rollover
        self.fail_control = fail_control
        self.lost_result = lost_result
        self.unknown_control = unknown_control
        self.commands = {}
        self.failed_once = False

    @activity.defn(name="advance_simulation_run_v1")
    async def advance(self, payload: dict) -> dict:
        self.calls.append(payload)
        key = payload["command_id"]
        if key not in self.commands:
            sequence = int(key.split(":")[1])
            complete = (sequence >= 130 if self.rollover else sequence > 0)
            if payload["entries_inhibited"]:
                complete = False
            self.commands[key] = {"schema_version": 1, "run_id": "kernel-run",
                "status": "completed_flat" if complete else "awaiting_evidence",
                "cursor_sequence": sequence, "projection_revision": sequence,
                "pending_obligations": not complete,
                "next_action": "completed" if complete else (
                    "advance" if self.rollover else "await_signal"), "next_wake_delay_ms": None}
        if self.lost_result and not self.failed_once:
            self.failed_once = True
            raise ApplicationError("Synthetic response lost after synthetic acceptance")
        return self.commands[key]

    @activity.defn(name="apply_simulation_control_v1")
    async def control(self, payload: dict) -> dict:
        self.controls.append(payload)
        if self.fail_control:
            raise ApplicationError("Synthetic control unavailable")
        if self.unknown_control:
            return {"status": "unknown"}
        return {"commandId": payload["control"]["command_id"],
                "operation": payload["control"]["operation"],
                "outcome": "applied", "projectionRevision": 100}


async def connect():
    address = os.environ.get("MOEAZI_Q4_TEMPORAL_ADDRESS")
    if not address:
        pytest.skip("explicit local Temporal opt-in required")
    if address != "127.0.0.1:7233":
        raise RuntimeError("Kernel qualification only permits the existing loopback Temporal")
    return await Client.connect(address, namespace="default")


def worker(client, queue, activities):
    return Worker(client, task_queue=queue, workflows=[SimulationSupervisorWorkflow],
                  activities=[activities.advance, activities.control],
                  max_concurrent_activities=2)


async def until(predicate, timeout=15):
    async with asyncio.timeout(timeout):
        while not await predicate():
            await asyncio.sleep(0.05)


async def status_is(handle, status):
    return (await handle.query("state"))["status"] == status


@pytest.mark.asyncio
async def test_real_temporal_worker_replacement_preserves_waiting_workflow():
    client = await connect()
    queue = f"q4-kernel-restart-{uuid4()}"
    activities = KernelActivities()
    handle = None
    try:
        async with worker(client, queue, activities):
            handle = await client.start_workflow(SimulationSupervisorWorkflow.run, binding(),
                                                id=queue, task_queue=queue)
            await until(lambda: status_is(handle, "awaiting_evidence"))
            history = await handle.fetch_history()
            watchdogs = [event.timer_started_event_attributes.start_to_fire_timeout.ToTimedelta()
                         for event in history.events if event.HasField("timer_started_event_attributes")]
            assert watchdogs and all(0 < timeout.total_seconds() <= 30 for timeout in watchdogs)
        assert len(activities.calls) == 1
        await handle.signal("wake")
        async with worker(client, queue, activities):
            result = await asyncio.wait_for(handle.result(), timeout=15)
        assert result["status"] == "completed_flat"
        assert [call["command_id"] for call in activities.calls] == ["advance:0", "advance:1"]
    finally:
        if handle:
            await handle.cancel()


@pytest.mark.asyncio
@pytest.mark.parametrize("unknown_result", [False, True])
async def test_real_temporal_control_failure_keeps_protection_path_and_inhibits_entries(unknown_result):
    client = await connect()
    queue = f"q4-kernel-control-{uuid4()}"
    activities = KernelActivities(fail_control=not unknown_result, unknown_control=unknown_result)
    handle = None
    try:
        async with worker(client, queue, activities):
            handle = await client.start_workflow(SimulationSupervisorWorkflow.run, binding(),
                                                id=queue, task_queue=queue)
            await until(lambda: status_is(handle, "awaiting_evidence"))
            await handle.signal("control", {"command_id": "stop-a", "operation": "stop_entries"})

            async def protected():
                return (await handle.query("state")).get("control_recovery_pending") is True

            await until(protected)
            assert len(activities.controls) == (1 if unknown_result else 3)
            assert activities.calls[-1]["entries_inhibited"] is True
            activities.fail_control = False
            activities.unknown_control = False
            await handle.signal("wake")
            result = await asyncio.wait_for(handle.result(), timeout=15)
        assert result["status"] == "completed_flat"
        assert {c["control"]["command_id"] for c in activities.controls} == {"stop-a"}
    finally:
        if handle:
            await handle.cancel()


@pytest.mark.asyncio
async def test_real_temporal_rollover_preserves_cursor_and_command_identity():
    client = await connect()
    queue = f"q4-kernel-rollover-{uuid4()}"
    activities = KernelActivities(rollover=True)
    async with worker(client, queue, activities):
        handle = await client.start_workflow(SimulationSupervisorWorkflow.run, binding(),
                                            id=queue, task_queue=queue)
        try:
            result = await asyncio.wait_for(handle.result(), timeout=45)
            assert result["status"] == "completed_flat"
            assert len(activities.commands) == 131
            assert [c["command_id"] for c in activities.calls] == [f"advance:{i}" for i in range(131)]
            assert (await handle.describe()).run_id != handle.first_execution_run_id
        finally:
            await handle.cancel()


@pytest.mark.asyncio
async def test_real_temporal_lost_activity_response_retries_identical_command():
    client = await connect()
    queue = f"q4-kernel-response-{uuid4()}"
    activities = KernelActivities(lost_result=True)
    async with worker(client, queue, activities):
        handle = await client.start_workflow(SimulationSupervisorWorkflow.run, binding(),
                                            id=queue, task_queue=queue)
        try:
            await until(lambda: status_is(handle, "awaiting_evidence"))
            assert activities.calls[0] == activities.calls[1]
            assert len(activities.commands) == 1
            await handle.signal("wake")
            result = await asyncio.wait_for(handle.result(), timeout=15)
            assert result["status"] == "completed_flat"
        finally:
            await handle.cancel()
