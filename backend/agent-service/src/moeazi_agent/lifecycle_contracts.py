"""Strict, simulation-ceiling intent, permit, and immutable execution-event wires."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .controller_contracts import ControllerRef
from .finance_contracts import (
    FinanceError, FinanceScope, StrictFinanceModel, _digest, _hash, _utc, native_int,
)
from .lifecycle_execution_envelope import ExecutionEnvelopeV1

CustomerMode = Literal["shadow", "approval_required", "autopilot"]
TradeAction = Literal["hold", "spot_buy", "spot_sell", "perp_open",
                      "perp_increase", "perp_reduce", "perp_close"]


def _version(value: object) -> int:
    if type(value) is not int or value != 1:
        raise FinanceError("lifecycle schema version must be the integer 1")
    return value


class ProtectionRequirement(StrictFinanceModel):
    required: bool
    policy_version: str = Field(min_length=1)
    policy_hash: str
    maximum_unprotected_seconds: int = Field(ge=0)
    on_rejection: Literal["hold_and_escalate", "request_reduce_only_close"]

    @field_validator("policy_hash")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        return _hash(value)


class TradeIntent(StrictFinanceModel):
    schema_version: Literal[1]
    scope: FinanceScope
    controller_ref: ControllerRef
    controller_mode: CustomerMode
    run_id: str = Field(min_length=1)
    run_manifest_hash: str
    intent_id: str = Field(min_length=1)
    strategy_artifact_hash: str
    instrument_version_id: str = Field(min_length=1)
    instrument_registry_hash: str
    action: TradeAction
    side: Literal["buy", "sell"] | None
    target_exposure_units: str
    desired_quantity_units: str
    horizon_seconds: int = Field(gt=0)
    evidence_snapshot_hash: str
    decision_context_hash: str | None = None
    calculation_receipt_hash: str | None
    supplied_claim_ids: tuple[str, ...]
    verified_claim_receipt_hashes: tuple[str, ...]
    rationale_summary: str = Field(min_length=1, max_length=1_000)
    invalidation_rule_hash: str
    expires_at_cursor: datetime
    protection: ProtectionRequirement
    maintenance_command_hash: str | None = Field(
        default=None, exclude_if=lambda value: value is None)
    intent_hash: str

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> int:
        return _version(value)

    @field_validator("run_manifest_hash", "strategy_artifact_hash", "instrument_registry_hash",
                     "evidence_snapshot_hash", "decision_context_hash",
                     "calculation_receipt_hash",
                     "invalidation_rule_hash", "maintenance_command_hash",
                     "intent_hash")
    @classmethod
    def hash_valid(cls, value: str | None) -> str | None:
        return _hash(value) if value is not None else None

    @field_validator("verified_claim_receipt_hashes")
    @classmethod
    def claim_hashes_valid(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        for item in value:
            _hash(item)
        return value

    @field_validator("target_exposure_units", "desired_quantity_units")
    @classmethod
    def units_valid(cls, value: str) -> str:
        native_int(value)
        return value

    @field_validator("expires_at_cursor")
    @classmethod
    def time_valid(cls, value: datetime) -> datetime:
        return _utc(value)

    @model_validator(mode="after")
    def check_identity_and_hash(self):
        if self.scope.environment != "experiment" or \
                self.controller_ref.environment != "experiment" or \
                self.controller_ref.strategyAccountId != self.scope.strategy_account_id or \
                self.controller_ref.controllerId != self.scope.scope_id:
            raise FinanceError("intent is not bound to its experiment controller")
        if self.action == "hold":
            if self.side is not None or self.desired_quantity_units != "0" or \
                    self.calculation_receipt_hash is not None or self.protection.required:
                raise FinanceError("hold cannot carry an executable order")
        elif self.side is None or native_int(self.desired_quantity_units, positive=True) <= 0 \
                or self.calculation_receipt_hash is None:
            raise FinanceError("executable intent lacks side, quantity, or calculation")
        if self.action == "spot_buy" and self.side != "buy" or \
                self.action == "spot_sell" and self.side != "sell":
            raise FinanceError("spot action and side disagree")
        if self.maintenance_command_hash is not None and (
                self.action not in {"spot_sell", "perp_reduce", "perp_close"} or
                self.protection.required):
            raise FinanceError("maintenance intent cannot increase or invent protection")
        body = self.model_dump(mode="json", exclude={"intent_hash"})
        if self.intent_hash != _digest("moeazi-trade-intent-v1", body):
            raise FinanceError("trade intent content hash differs")
        return self


class ExecutionPermit(StrictFinanceModel):
    schema_version: Literal[1]
    scope: FinanceScope
    controller_ref: ControllerRef
    controller_mode: CustomerMode
    run_id: str = Field(min_length=1)
    run_manifest_hash: str
    intent_id: str = Field(min_length=1)
    intent_hash: str
    order_id: str = Field(min_length=1)
    order_ordinal: int = Field(gt=0)
    client_id: str = Field(min_length=1)
    attempt_id: str = Field(min_length=1)
    reservation_id: str = Field(min_length=1)
    protection_order_id: str | None = None
    originating_order_id: str | None = None
    normalized_payload_hash: str
    instrument_version_id: str = Field(min_length=1)
    instrument_registry_hash: str
    action: TradeAction
    side: Literal["buy", "sell"]
    quantity_kind: Literal["asset_native", "contracts"]
    contract_size_unit_id: str | None
    contract_size_units: str | None
    quantity_asset_unit_id: str = Field(min_length=1)
    quantity_registry_hash: str
    quote_asset_unit_id: str = Field(min_length=1)
    quote_registry_hash: str
    settlement_asset_unit_id: str = Field(min_length=1)
    settlement_registry_hash: str
    quantity_units: str
    location_id: str = Field(min_length=1)
    account_revision: int = Field(ge=0)
    writer_epoch: int = Field(gt=0)
    authority_epoch: int = Field(ge=0)
    policy_hash: str
    evidence_snapshot_hash: str
    decision_context_hash: str | None = None
    approval_receipt_hash: str | None
    maintenance_receipt_hash: str | None = Field(
        default=None, exclude_if=lambda value: value is None)
    issued_at_cursor: datetime
    valid_until_cursor: datetime
    transport: Literal["simulated"]
    execution_envelope: ExecutionEnvelopeV1 | None = Field(
        default=None, exclude_if=lambda value: value is None)
    permit_hash: str

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> int:
        return _version(value)

    @field_validator("run_manifest_hash", "intent_hash", "normalized_payload_hash",
                     "policy_hash", "evidence_snapshot_hash",
                     "decision_context_hash", "approval_receipt_hash",
                     "maintenance_receipt_hash",
                     "instrument_registry_hash", "quantity_registry_hash",
                     "quote_registry_hash", "settlement_registry_hash",
                     "permit_hash")
    @classmethod
    def hash_valid(cls, value: str | None) -> str | None:
        return _hash(value) if value is not None else None

    @field_validator("quantity_units", "contract_size_units")
    @classmethod
    def quantity_valid(cls, value: str | None) -> str | None:
        if value is not None:
            native_int(value, positive=True)
        return value

    @field_validator("issued_at_cursor", "valid_until_cursor")
    @classmethod
    def time_valid(cls, value: datetime) -> datetime:
        return _utc(value)

    @model_validator(mode="after")
    def check_permit(self):
        if self.scope.environment != "experiment" or \
                self.controller_ref.environment != "experiment" or \
                self.controller_ref.strategyAccountId != self.scope.strategy_account_id or \
                self.controller_ref.controllerId != self.scope.scope_id:
            raise FinanceError("permit is not bound to its experiment controller")
        if self.valid_until_cursor <= self.issued_at_cursor:
            raise FinanceError("simulated permit expires before issue")
        if self.action == "hold" or (self.quantity_kind == "contracts" and
                (not self.contract_size_unit_id or self.contract_size_units is None)) or \
                (self.quantity_kind == "asset_native" and
                 (self.contract_size_unit_id is not None or self.contract_size_units is not None)):
            raise FinanceError("permit lacks an executable quantity identity")
        if (self.action == "spot_buy" and self.side != "buy") or \
                (self.action == "spot_sell" and self.side != "sell") or \
                (self.action.startswith("spot_") and self.quantity_kind != "asset_native") or \
                (self.action.startswith("perp_") and self.quantity_kind != "contracts"):
            raise FinanceError("permit action, side, and quantity kind disagree")
        if (self.protection_order_id is None) != (self.originating_order_id is None) or \
                (self.protection_order_id is not None and
                 (self.protection_order_id != self.order_id or
                  self.originating_order_id == self.order_id or
                  self.action not in {"spot_sell", "perp_reduce", "perp_close"})):
            raise FinanceError("protective permit lacks a separate reduction order")
        if self.maintenance_receipt_hash is not None and (
                self.protection_order_id != self.order_id or
                self.originating_order_id is None or
                self.approval_receipt_hash is not None or
                self.execution_envelope is None):
            raise FinanceError("maintenance permit lacks one exact reduction authority")
        if self.controller_mode == "approval_required" and \
                self.approval_receipt_hash is None and \
                self.maintenance_receipt_hash is None:
            raise FinanceError("approval simulation requires an exact authority receipt")
        envelope = self.execution_envelope
        if envelope is not None and (
                envelope.scope != self.scope or envelope.run_id != self.run_id or
                envelope.manifest_hash != self.run_manifest_hash or
                envelope.instrument_version_id != self.instrument_version_id or
                envelope.instrument_registry_hash != self.instrument_registry_hash or
                envelope.action != self.action or envelope.side != self.side or
                envelope.quantity_kind != self.quantity_kind or
                envelope.location_id != self.location_id or
                envelope.decision_hash != self.decision_context_hash or
                envelope.issued_at_cursor != self.issued_at_cursor or
                envelope.max_quantity_units != self.quantity_units):
            raise FinanceError("permit differs from its causal execution envelope")
        body = self.model_dump(mode="json", exclude={"permit_hash"})
        if self.permit_hash != _digest("moeazi-execution-permit-v1", body):
            raise FinanceError("execution permit content hash differs")
        return self


from .lifecycle_events import ExecutionEvent
