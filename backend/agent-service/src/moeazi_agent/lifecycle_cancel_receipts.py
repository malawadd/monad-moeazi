"""Immutable replay-time cancellation dispatch, with no financial authority."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator
from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, StrictFinanceModel, _digest, _hash, _utc
from .lifecycle_run_store import _run_params
from .simulation_workflow_contracts import SimulationControl


def control_hash(scope, run_id, manifest_hash, command_id, operation, target_id):
    control = SimulationControl(command_id=command_id, operation=operation,
        order_id=target_id if operation == "request_cancel" else None,
        instrument_version_id=target_id if operation == "request_close" else None)
    return _digest("moeazi-simulation-control-v1", {
        "scope": scope.model_dump(mode="json"), "runId": run_id,
        "manifestHash": manifest_hash, "control": control.model_dump(mode="json")})


class CancelDispatchReceipt(StrictFinanceModel):
    schemaVersion: Literal[1]
    scope: FinanceScope
    runId: str = Field(min_length=1)
    manifestHash: str
    commandId: str = Field(min_length=1, max_length=160)
    commandHash: str
    operation: Literal["request_cancel"]
    processingKind: Literal["dispatched"]
    outcome: Literal["requested"]
    targetOrderId: str = Field(min_length=1, max_length=256)
    permitHash: str
    requestedCursor: datetime
    effectiveCursor: datetime
    resultHash: str

    @field_validator("schemaVersion", mode="before")
    @classmethod
    def exact_version(cls, value):
        if type(value) is not int or value != 1:
            raise FinanceError("Cancellation receipt requires integer version 1")
        return value

    @field_validator("manifestHash", "commandHash", "permitHash", "resultHash")
    @classmethod
    def hash_valid(cls, value):
        return _hash(value)

    @field_validator("requestedCursor", "effectiveCursor")
    @classmethod
    def cursor_valid(cls, value):
        return _utc(value)

    @model_validator(mode="after")
    def coherent(self):
        if self.scope.environment != "experiment" or self.effectiveCursor < self.requestedCursor:
            raise FinanceError("Cancellation receipt has invalid replay authority or time")
        if self.commandHash != control_hash(self.scope, self.runId, self.manifestHash,
                self.commandId, self.operation, self.targetOrderId):
            raise FinanceError("Cancellation receipt differs from its command")
        if self.resultHash != _digest("moeazi-simulation-control-processing-v1",
                self.model_dump(mode="json", exclude={"resultHash"})):
            raise FinanceError("Cancellation receipt content hash differs")
        return self


def seal_cancel_dispatch(**body) -> CancelDispatchReceipt:
    body["scope"] = FinanceScope.model_validate(body["scope"])
    provisional = CancelDispatchReceipt.model_construct(**body)
    body["resultHash"] = _digest("moeazi-simulation-control-processing-v1",
        provisional.model_dump(mode="json", exclude={"resultHash"}))
    return CancelDispatchReceipt.model_validate(body)


async def load_cancel_dispatches(conn, manifest) -> tuple[CancelDispatchReceipt, ...]:
    rows = (await conn.execute(text("""
        SELECT p.result_json,p.result_hash,p.processed_at_cursor,p.target_order_id,
          p.terminal_event_hash,c.command_id,c.command_hash,c.operation,c.target_id,c.outcome
        FROM simulation_control_processing p JOIN simulation_commands c
          USING(environment,scope_id,strategy_account_id,run_id,command_id)
        WHERE p.environment=:environment AND p.scope_id=:scope_id
          AND p.strategy_account_id=:strategy_account_id AND p.run_id=:run_id
          AND p.processing_kind='dispatched' AND c.operation='request_cancel'
        ORDER BY p.processed_at_cursor,c.command_id
    """), _run_params(manifest.scope, manifest.run_id))).mappings().all()
    result = []
    for row in rows:
        receipt = CancelDispatchReceipt.model_validate_json(json.dumps(row["result_json"]))
        if receipt.scope != manifest.scope or receipt.runId != manifest.run_id or \
                receipt.manifestHash != manifest.manifest_hash or \
                receipt.commandId != row["command_id"] or receipt.commandHash != row["command_hash"] or \
                receipt.resultHash != row["result_hash"] or row["outcome"] != "applied" or \
                receipt.targetOrderId != row["target_id"] or \
                receipt.targetOrderId != row["target_order_id"] or \
                receipt.requestedCursor != row["processed_at_cursor"] or \
                row["terminal_event_hash"] is not None or \
                not manifest.scenario.simulation_cursor_at <= receipt.requestedCursor <= \
                    manifest.scenario.simulation_end_at:
            raise FinanceError("Stored cancellation dispatch differs from owned command")
        result.append(receipt)
    return tuple(result)
