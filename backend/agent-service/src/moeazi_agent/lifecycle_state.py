"""Durable simulation status wires; these do not themselves authorize an entry."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .controller_contracts import ControllerRef
from .finance_contracts import FinanceError, FinanceScope, StrictFinanceModel, _hash, _utc, native_int
from .lifecycle_contracts import CustomerMode


def _version(value: object) -> int:
    if type(value) is not int or value != 1:
        raise FinanceError("lifecycle state schema version must be the integer 1")
    return value


class EntryAuthorizationRequest(StrictFinanceModel):
    """Only a server-loaded run may be passed to the external identity callback."""
    schema_version: Literal[1]
    scope: FinanceScope
    run_id: str = Field(min_length=1)
    manifest_hash: str
    created_by_subject: str = Field(min_length=1)
    experiment_request_hash: str
    controller_ref: ControllerRef
    controller_mode: CustomerMode
    registered_authority_fingerprint: str
    authority_epoch: int = Field(ge=0)

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> int:
        return _version(value)

    @field_validator("manifest_hash", "experiment_request_hash", "registered_authority_fingerprint")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        return _hash(value)

    @model_validator(mode="after")
    def check_scope(self):
        if self.scope.environment != "experiment" or self.controller_ref.environment != \
                "experiment" or self.controller_ref.controllerId != self.scope.scope_id or \
                self.controller_ref.strategyAccountId != self.scope.strategy_account_id:
            raise FinanceError("entry authorization is not bound to the persisted experiment")
        return self


class EntryAuthorityReceipt(StrictFinanceModel):
    """Fresh identity response; SQL still checks its own epoch and financial state."""
    schema_version: Literal[1]
    scope: FinanceScope
    run_id: str = Field(min_length=1)
    controller_ref: ControllerRef
    controller_mode: CustomerMode
    created_by_subject: str = Field(min_length=1)
    experiment_request_hash: str
    authority_fingerprint: str
    checked_at: datetime

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> int:
        return _version(value)

    @field_validator("experiment_request_hash", "authority_fingerprint")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        return _hash(value)

    @field_validator("checked_at")
    @classmethod
    def time_valid(cls, value: datetime) -> datetime:
        return _utc(value)

    @model_validator(mode="after")
    def check_scope(self):
        if self.scope.environment != "experiment" or self.controller_ref.environment != \
                "experiment" or self.controller_ref.controllerId != self.scope.scope_id or \
                self.controller_ref.strategyAccountId != self.scope.strategy_account_id:
            raise FinanceError("entry authority receipt crosses an experiment scope")
        return self


class PositionProtectionState(StrictFinanceModel):
    schema_version: Literal[1]
    scope: FinanceScope
    run_id: str = Field(min_length=1)
    instrument_version_id: str = Field(min_length=1)
    originating_controller_ref: ControllerRef
    management_controller_ref: ControllerRef
    quantity_kind: Literal["asset_native", "contracts"]
    signed_exposure_units: str
    attributed_filled_units: str
    cost_basis_numerator: str
    cost_basis_denominator: str
    collateral_asset_unit_id: str | None
    collateral_units: str
    intended_protection_hash: str | None
    requested_protection_order_id: str | None
    confirmed_protection_event_hash: str | None
    rejected_protection_event_hash: str | None
    reconciliation_state: Literal["clean", "awaiting_events", "awaiting_journal",
                                  "awaiting_checkpoint", "unknown", "quarantined"]
    pending_obligations: bool
    reason: str | None
    revision: int = Field(ge=0)

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> int:
        return _version(value)

    @field_validator("intended_protection_hash", "confirmed_protection_event_hash",
                     "rejected_protection_event_hash")
    @classmethod
    def hash_valid(cls, value: str | None) -> str | None:
        return _hash(value) if value is not None else None

    @field_validator("signed_exposure_units", "cost_basis_numerator")
    @classmethod
    def signed_units(cls, value: str) -> str:
        native_int(value)
        return value

    @field_validator("attributed_filled_units", "collateral_units")
    @classmethod
    def nonnegative_units(cls, value: str) -> str:
        native_int(value, nonnegative=True)
        return value

    @field_validator("cost_basis_denominator")
    @classmethod
    def denominator(cls, value: str) -> str:
        native_int(value, positive=True)
        return value

    @model_validator(mode="after")
    def check_protection(self):
        if self.scope.environment != "experiment" or self.originating_controller_ref.environment \
                != "experiment" or self.management_controller_ref.environment != "experiment" or \
                self.originating_controller_ref.strategyAccountId != self.scope.strategy_account_id or \
                self.management_controller_ref.strategyAccountId != self.scope.strategy_account_id or \
                self.originating_controller_ref.controllerId != self.scope.scope_id or \
                self.management_controller_ref.controllerId != self.scope.scope_id:
            raise FinanceError("position management crosses an experiment account")
        if self.confirmed_protection_event_hash and self.rejected_protection_event_hash:
            raise FinanceError("one protection request cannot be both confirmed and rejected")
        if self.confirmed_protection_event_hash and not self.requested_protection_order_id:
            raise FinanceError("confirmed protection lacks a requested order")
        if native_int(self.signed_exposure_units) != 0 and \
                not self.confirmed_protection_event_hash and not self.pending_obligations:
            raise FinanceError("unprotected exposure cannot be obligation-free")
        return self


class ReconciliationResult(StrictFinanceModel):
    schema_version: Literal[1]
    scope: FinanceScope
    run_id: str = Field(min_length=1)
    order_id: str = Field(min_length=1)
    source_event_hashes: tuple[str, ...]
    cumulative_filled_units: str
    outstanding_units: str
    terminal_event_hash: str | None
    protection_event_hash: str | None
    journal_transaction_ids: tuple[str, ...]
    account_snapshot_hash: str | None
    retained_capacity_units: str
    exposure_uncertain: bool
    unsupported_mechanics: tuple[str, ...]
    state: Literal["clean", "awaiting_evidence", "awaiting_journal",
                   "awaiting_checkpoint", "quarantined"]
    reason: str | None

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> int:
        return _version(value)

    @field_validator("terminal_event_hash", "protection_event_hash", "account_snapshot_hash")
    @classmethod
    def optional_hash(cls, value: str | None) -> str | None:
        return _hash(value) if value is not None else None

    @field_validator("source_event_hashes")
    @classmethod
    def event_hashes(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        for item in value:
            _hash(item)
        if len(set(value)) != len(value):
            raise FinanceError("reconciliation repeats an event hash")
        return value

    @field_validator("cumulative_filled_units", "outstanding_units", "retained_capacity_units")
    @classmethod
    def nonnegative_units(cls, value: str) -> str:
        native_int(value, nonnegative=True)
        return value

    @model_validator(mode="after")
    def check_retention(self):
        if self.scope.environment != "experiment":
            raise FinanceError("new lifecycle reconciliation is simulation-only")
        if self.exposure_uncertain and self.state == "clean":
            raise FinanceError("uncertain exposure cannot reconcile clean")
        if self.unsupported_mechanics and self.state == "clean":
            raise FinanceError("unsupported mechanics cannot reconcile clean")
        if self.state != "clean" and not self.reason:
            raise FinanceError("incomplete reconciliation needs a reason")
        return self


class RunAdvanceResult(StrictFinanceModel):
    schema_version: Literal[1]
    run_id: str = Field(min_length=1)
    status: Literal["registered", "running", "awaiting_evidence", "awaiting_protection",
                    "stopped_with_exposure", "quarantined", "completed_flat"]
    cursor_sequence: int = Field(ge=0)
    pending_obligations: bool
    next_action: Literal["advance", "await_signal", "completed"]
    projection_revision: int = Field(ge=0)
    next_wake_delay_ms: int | None = Field(default=None, ge=0, le=86_400_000)

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> int:
        return _version(value)

    @model_validator(mode="after")
    def check_terminal(self):
        if (self.next_action == "completed") != (self.status == "completed_flat"):
            raise FinanceError("only a flat run may complete")
        if self.next_action == "completed" and (self.pending_obligations or
                self.next_wake_delay_ms is not None):
            raise FinanceError("terminal run retains work")
        return self
