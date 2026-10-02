"""Identifier-only Temporal wires; executable facts stay in scoped storage."""
from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator, model_validator

from .finance_contracts import FinanceError, FinanceScope, StrictFinanceModel, _hash


class SimulationControl(StrictFinanceModel):
    command_id: str = Field(min_length=1, max_length=160)
    operation: Literal["stop_entries", "request_cancel", "request_close"]
    order_id: str | None = Field(default=None, max_length=256)
    instrument_version_id: str | None = Field(default=None, max_length=256)

    @model_validator(mode="after")
    def target_identity(self):
        if self.operation == "stop_entries" and (self.order_id is not None
                                                  or self.instrument_version_id is not None):
            raise FinanceError("Account stop cannot carry an order or instrument override")
        if self.operation == "request_cancel" and (not self.order_id
                                                    or self.instrument_version_id is not None):
            raise FinanceError("Cancellation requires one scoped order identity")
        if self.operation == "request_close" and (self.order_id is not None
                                                   or not self.instrument_version_id):
            raise FinanceError("Close requires one scoped instrument identity")
        return self


class SimulationControlResult(StrictFinanceModel):
    commandId: str = Field(min_length=1, max_length=160)
    operation: Literal["stop_entries", "request_cancel", "request_close"]
    outcome: Literal["applied", "rejected"]
    projectionRevision: int = Field(ge=0)


class SimulationRunBinding(StrictFinanceModel):
    scope: FinanceScope
    run_id: str = Field(min_length=1, max_length=256)
    manifest_hash: str

    @field_validator("manifest_hash")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        return _hash(value)

    @model_validator(mode="after")
    def experimental_only(self):
        if self.scope.environment != "experiment":
            raise FinanceError("Simulation workflow cannot bind a live scope")
        return self

    def activity_binding(self) -> dict:
        return {"scope": self.scope.model_dump(), "run_id": self.run_id,
                "manifest_hash": self.manifest_hash}


class SimulationWorkflowInput(SimulationRunBinding):
    command_sequence: int = Field(default=0, ge=0)
    last_cursor_sequence: int = Field(default=-1, ge=-1)
    last_projection_revision: int = Field(default=-1, ge=-1)
    pending_controls: tuple[SimulationControl, ...] = Field(default=(), max_length=128)
