"""Narrow reduce-only authority from an authenticated close and source obligations."""
from __future__ import annotations

from typing import Literal

from pydantic import Field, StrictInt, field_validator, model_validator

from .controller_contracts import ControllerRef
from .finance_contracts import (
    FinanceError, FinanceScope, StrictFinanceModel, _digest, _hash, native_int,
)


class MaintenanceObligationRef(StrictFinanceModel):
    protection_order_id: str = Field(min_length=1)
    intended_hash: str
    originating_event_hash: str

    @field_validator("intended_hash", "originating_event_hash")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        return _hash(value)


def maintenance_order_id(scope: FinanceScope, run_id: str,
                         command_id: str, command_hash: str) -> str:
    return _digest("moeazi-maintenance-order-v1", {
        "scope": scope.model_dump(mode="json"), "runId": run_id,
        "commandId": command_id, "commandHash": _hash(command_hash),
    })


class MaintenanceReductionReceipt(StrictFinanceModel):
    """A close command narrows one exact position, even after entries stop."""
    schema_version: Literal[1]
    scope: FinanceScope
    controller_ref: ControllerRef
    run_id: str = Field(min_length=1)
    manifest_hash: str
    command_id: str = Field(min_length=1, max_length=200)
    command_hash: str
    maintenance_order_id: str
    order_ordinal: StrictInt = Field(gt=0)
    instrument_version_id: str = Field(min_length=1)
    location_id: str = Field(min_length=1)
    anchor_protection_order_id: str = Field(min_length=1)
    obligations: tuple[MaintenanceObligationRef, ...] = Field(min_length=1)
    account_snapshot_hash: str
    account_revision: StrictInt = Field(ge=0)
    authority_epoch: StrictInt = Field(ge=0)
    position_state_hash: str
    position_revision: StrictInt = Field(gt=0)
    signed_exposure_units: str
    reduction_action: Literal["spot_sell", "perp_reduce", "perp_close"]
    side: Literal["buy", "sell"]
    quantity_units: str
    decision_hash: str
    sizing_receipt_hash: str
    reservation_id: str = Field(min_length=1)
    intent_id: str = Field(min_length=1)
    intent_hash: str
    execution_envelope_hash: str
    receipt_hash: str

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> int:
        if type(value) is not int or value != 1:
            raise FinanceError("maintenance receipt requires integer schema version 1")
        return value

    @field_validator("manifest_hash", "command_hash", "account_snapshot_hash",
                     "position_state_hash", "decision_hash", "sizing_receipt_hash",
                     "intent_hash", "execution_envelope_hash", "receipt_hash",
                     "maintenance_order_id")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        return _hash(value)

    @field_validator("signed_exposure_units")
    @classmethod
    def signed_amount(cls, value: str) -> str:
        native_int(value)
        return value

    @field_validator("quantity_units")
    @classmethod
    def positive_amount(cls, value: str) -> str:
        native_int(value, positive=True)
        return value

    @model_validator(mode="after")
    def reduce_only(self):
        exposure = native_int(self.signed_exposure_units)
        if self.scope.environment != "experiment" or \
                self.controller_ref.environment != "experiment" or \
                self.controller_ref.strategyAccountId != self.scope.strategy_account_id or \
                self.controller_ref.controllerId != self.scope.scope_id or \
                exposure == 0 or native_int(self.quantity_units) > abs(exposure):
            raise FinanceError("maintenance cannot expand or cross controller exposure")
        if self.side != ("sell" if exposure > 0 else "buy") or \
                (self.reduction_action == "spot_sell" and exposure < 0):
            raise FinanceError("maintenance side cannot increase exposure")
        keys = tuple(row.protection_order_id for row in self.obligations)
        if keys != tuple(sorted(set(keys))) or \
                self.anchor_protection_order_id != keys[0]:
            raise FinanceError("maintenance needs the complete canonical obligation set")
        if self.maintenance_order_id != maintenance_order_id(self.scope, self.run_id,
                self.command_id, self.command_hash):
            raise FinanceError("maintenance order id differs from close command")
        if self.maintenance_order_id == self.anchor_protection_order_id:
            raise FinanceError("maintenance order id collides with its source obligation")
        if self.receipt_hash != _digest("moeazi-maintenance-reduction-v1",
                self.model_dump(mode="json", exclude={"receipt_hash"})):
            raise FinanceError("maintenance reduction receipt hash differs")
        return self
