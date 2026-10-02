"""Versioned durable simulation supervision, separate from analyst workflows."""
from __future__ import annotations

import asyncio
import json
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from .lifecycle_state import RunAdvanceResult
    from .simulation_runtime_config import SIMULATION_WORKFLOW
    from .simulation_workflow_contracts import (
        SimulationControl, SimulationControlResult, SimulationWorkflowInput,
    )


_RETRY = RetryPolicy(initial_interval=timedelta(milliseconds=250),
                     maximum_interval=timedelta(seconds=2), maximum_attempts=3)


def _checked_control(outcome: dict, control: SimulationControl) -> dict:
    result = SimulationControlResult.model_validate_json(json.dumps(outcome, allow_nan=False))
    if result.commandId != control.command_id or result.operation != control.operation:
        raise ValueError("Simulation control receipt does not match its command")
    if control.operation == "stop_entries" and result.outcome != "applied":
        raise ValueError("Unconfirmed stop cannot allow new entries")
    return result.model_dump(mode="json")


def _checked_result(result: dict, cursor: int, revision: int, run_id: str) -> dict:
    """Defense against a malformed internal activity claiming terminal success."""
    result = RunAdvanceResult.model_validate_json(json.dumps(result, allow_nan=False)).model_dump(mode="json")
    if result["run_id"] != run_id:
        raise ValueError("Simulation activity returned another run")
    if result["cursor_sequence"] < cursor or result["projection_revision"] < revision:
        raise ValueError("Simulation activity regressed durable progress")
    action = result["next_action"]
    if action == "advance" and result["cursor_sequence"] == cursor \
            and result["projection_revision"] == revision:
        raise ValueError("Simulation advance made no durable progress")
    return result


@workflow.defn(name=SIMULATION_WORKFLOW)
class SimulationSupervisorWorkflow:
    def __init__(self):
        self._controls: list[SimulationControl] = []
        self._wake_generation = 0
        self._status = {"status": "starting", "pending_obligations": True}
        self._last_control: dict | None = None

    @workflow.signal
    def wake(self) -> None:
        self._wake_generation += 1

    @workflow.signal
    def control(self, payload: dict) -> None:
        try:
            command = SimulationControl.model_validate_json(json.dumps(payload, allow_nan=False))
            if len(self._controls) >= 128:
                raise ValueError("control queue full")
            same_id = [item for item in self._controls if item.command_id == command.command_id]
            if same_id and any(item != command for item in same_id):
                raise ValueError("control identity conflicts")
            if not same_id:
                if command.operation == "stop_entries":
                    self._controls.insert(0, command)
                else:
                    self._controls.append(command)
            self._wake_generation += 1
        except (ValueError, TypeError):
            self._last_control = {"status": "rejected", "reason": "invalid_control_signal"}

    @workflow.query
    def state(self) -> dict:
        return {**self._status, "pending_controls": len(self._controls),
                "last_control": self._last_control, "authority": "simulation_only"}

    async def _wait(self, generation: int, delay_ms: int | None = None) -> None:
        try:
            await workflow.wait_condition(
                lambda: self._wake_generation != generation,
                timeout=timedelta(milliseconds=max(100, delay_ms)) if delay_ms is not None else None,
            )
        except asyncio.TimeoutError:
            pass

    @workflow.run
    async def run(self, payload: dict) -> dict:
        binding = SimulationWorkflowInput.model_validate_json(json.dumps(payload, allow_nan=False))
        self._controls.extend(binding.pending_controls)
        sequence = binding.command_sequence
        cursor, revision = binding.last_cursor_sequence, binding.last_projection_revision
        attempted_steps = 0
        while True:
            if attempted_steps >= 128:
                rollover = binding.model_copy(update={"command_sequence": sequence,
                    "last_cursor_sequence": cursor, "last_projection_revision": revision,
                    "pending_controls": tuple(self._controls)})
                workflow.continue_as_new(rollover.model_dump(mode="json"))
            attempted_steps += 1
            generation = self._wake_generation
            control_uncertain = False
            if self._controls:
                control = self._controls[0]
                try:
                    outcome = await workflow.execute_activity(
                        "apply_simulation_control_v1",
                        {**binding.activity_binding(), "control": control.model_dump(mode="json")},
                        start_to_close_timeout=timedelta(seconds=30), retry_policy=_RETRY,
                        activity_id=f"control:{sequence}:{control.command_id}",
                    )
                    # An idempotent receipt retains its original revision; later
                    # protection work may already have advanced the run further.
                    outcome = _checked_control(outcome, control)
                    self._controls.remove(control)
                    self._last_control = {"command_id": control.command_id, "outcome": outcome}
                    sequence += 1
                except (ActivityError, ValueError):
                    self._status = {"status": "control_recovery_pending", "pending_obligations": True}
                    control_uncertain = True
            try:
                result = await workflow.execute_activity(
                    "advance_simulation_run_v1",
                    {**binding.activity_binding(), "command_id": f"advance:{sequence}",
                     "entries_inhibited": control_uncertain},
                    start_to_close_timeout=timedelta(seconds=30), retry_policy=_RETRY,
                    activity_id=f"advance:{sequence}",
                )
                result = _checked_result(result, cursor, revision, binding.run_id)
            except (ActivityError, ValueError):
                self._status = {"status": "recovery_pending", "pending_obligations": True}
                await self._wait(generation, 30_000)
                continue
            self._status = result
            if control_uncertain:
                self._status = {**result, "control_recovery_pending": True}
            cursor, revision = result["cursor_sequence"], result["projection_revision"]
            sequence += 1
            if result["next_action"] == "completed" and not self._controls:
                return self.state()
            if control_uncertain:
                await self._wait(generation, 30_000)
                continue
            if result["next_action"] == "await_signal" and not self._controls:
                delay = result.get("next_wake_delay_ms")
                if result["pending_obligations"]:
                    # Lost signals cannot strand protection. This wake checks SQL;
                    # it does not poll Convex or invoke an analyst/provider.
                    delay = min(delay, 30_000) if delay is not None else 30_000
                await self._wait(generation, delay)
