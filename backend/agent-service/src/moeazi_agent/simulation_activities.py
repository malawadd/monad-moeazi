"""Narrow Temporal activities for persisted experimental runs only."""
from __future__ import annotations

import json
from typing import Protocol

from pydantic import Field
from temporalio import activity
from temporalio.exceptions import ApplicationError

from .finance_contracts import FinanceError, FinanceScope
from .lifecycle_state import RunAdvanceResult
from .simulation_workflow_contracts import SimulationControl, SimulationRunBinding


class AdvanceInput(SimulationRunBinding):
    command_id: str = Field(min_length=1, max_length=160)
    entries_inhibited: bool


class ControlInput(SimulationRunBinding):
    control: SimulationControl


class SimulationRepository(Protocol):
    async def advance_run(self, scope: FinanceScope, run_id: str, manifest_hash: str,
                          worker_id: str, command_id: str, *,
                          entries_inhibited: bool = False) -> RunAdvanceResult: ...

    async def apply_control(self, scope: FinanceScope, run_id: str, manifest_hash: str,
                            control: SimulationControl, *, worker_id: str,
                            command_id: str) -> dict: ...


class SimulationActivities:
    def __init__(self, repository: SimulationRepository, worker_id: str):
        if not worker_id or len(worker_id) > 160:
            raise FinanceError("Simulation activity requires a bounded physical worker identity")
        self._repository = repository
        self._worker_id = worker_id

    @activity.defn(name="advance_simulation_run_v1")
    async def advance(self, payload: dict) -> dict:
        try:
            request = AdvanceInput.model_validate_json(json.dumps(payload, allow_nan=False))
        except (ValueError, TypeError):
            raise ApplicationError("Invalid simulation activity binding", non_retryable=True) from None
        result = await self._repository.advance_run(request.scope, request.run_id,
            request.manifest_hash, self._worker_id, request.command_id,
            entries_inhibited=request.entries_inhibited)
        return result.model_dump(mode="json")

    @activity.defn(name="apply_simulation_control_v1")
    async def control(self, payload: dict) -> dict:
        try:
            request = ControlInput.model_validate_json(json.dumps(payload, allow_nan=False))
        except (ValueError, TypeError):
            raise ApplicationError("Invalid simulation control binding", non_retryable=True) from None
        return await self._repository.apply_control(request.scope, request.run_id,
            request.manifest_hash, request.control, worker_id=self._worker_id,
            command_id=request.control.command_id)
