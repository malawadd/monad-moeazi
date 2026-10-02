"""Immutable, experiment-only replay sizing calculation receipt."""
from __future__ import annotations

from datetime import datetime
from fractions import Fraction
from typing import Literal

from pydantic import Field, StrictInt, field_validator, model_validator

from .finance_contracts import (
    FinanceError, FinanceScope, ReservationComponent, StrictFinanceModel,
    _digest, _hash, _utc, native_int,
)
from .lifecycle_execution_envelope import ExecutionEnvelopeV1
from .lifecycle_position_math_contracts import PositionArithmeticState

ReplayAction = Literal["spot_buy", "spot_sell", "perp_open", "perp_increase",
                       "perp_reduce", "perp_close"]


class ReplaySizingReceipt(StrictFinanceModel):
    schema_version: Literal[1]
    code_version: Literal["replay-sizing-v1", "replay-sizing-v2"]
    valuation_scope: Literal["instrument_only"]
    scope: FinanceScope
    run_id: str = Field(min_length=1)
    manifest_hash: str
    request_id: str = Field(min_length=1)
    decision_hash: str
    evidence_snapshot_hash: str
    selected_observation_hash: str
    account_snapshot_hash: str
    account_revision: str
    policy_version: str = Field(min_length=1)
    policy_hash: str
    instrument_version_id: str = Field(min_length=1)
    instrument_registry_hash: str
    action: ReplayAction
    side: Literal["buy", "sell"]
    quantity_kind: Literal["asset_native", "contracts"]
    order_ordinal: int = Field(gt=0)
    replay_cursor_at: datetime
    location_id: str = Field(min_length=1)
    base_asset_unit_id: str = Field(min_length=1)
    base_registry_hash: str
    quote_asset_unit_id: str = Field(min_length=1)
    quote_registry_hash: str
    settlement_asset_unit_id: str = Field(min_length=1)
    settlement_registry_hash: str
    contract_size_unit_id: str | None
    contract_size_units: str | None
    price_numerator: str
    price_denominator: str
    desired_quantity_units: str
    quantity_units: str
    target_exposure_units: str
    notional_units: str
    risk_notional_units: str
    fee_budget_quote_units: str
    components: tuple[ReservationComponent, ...] = Field(min_length=1)
    execution_envelope: ExecutionEnvelopeV1 | None = Field(
        default=None, exclude_if=lambda value: value is None)
    position_state_hash: str | None = Field(
        default=None, exclude_if=lambda value: value is None)
    position_revision: StrictInt | None = Field(
        default=None, exclude_if=lambda value: value is None)
    position_state: PositionArithmeticState | None = Field(
        default=None, exclude_if=lambda value: value is None)
    receipt_hash: str

    @field_validator("schema_version", "order_ordinal", mode="before")
    @classmethod
    def exact_number(cls, value: object) -> int:
        if type(value) is not int:
            raise FinanceError("replay sizing version and ordinal require exact integers")
        return value

    @field_validator("manifest_hash", "decision_hash", "evidence_snapshot_hash",
                     "selected_observation_hash", "account_snapshot_hash",
                     "policy_hash", "instrument_registry_hash", "base_registry_hash",
                     "quote_registry_hash", "settlement_registry_hash",
                     "position_state_hash", "receipt_hash")
    @classmethod
    def hash_valid(cls, value: str | None) -> str | None:
        return _hash(value) if value is not None else None

    @field_validator("account_revision", "notional_units", "risk_notional_units",
                     "fee_budget_quote_units")
    @classmethod
    def nonnegative_units(cls, value: str) -> str:
        native_int(value, nonnegative=True)
        return value

    @field_validator("price_numerator", "price_denominator",
                     "desired_quantity_units", "quantity_units", "contract_size_units")
    @classmethod
    def positive_units(cls, value: str | None) -> str | None:
        if value is not None:
            native_int(value, positive=True)
        return value

    @field_validator("target_exposure_units")
    @classmethod
    def signed_units(cls, value: str) -> str:
        native_int(value)
        return value

    @field_validator("replay_cursor_at")
    @classmethod
    def valid_cursor(cls, value: datetime) -> datetime:
        return _utc(value)

    @model_validator(mode="after")
    def exact_receipt(self):
        if self.scope.environment != "experiment" or \
                (self.action.startswith("spot_")) != (self.quantity_kind == "asset_native") or \
                (self.action == "spot_buy" and self.side != "buy") or \
                (self.action == "spot_sell" and self.side != "sell") or \
                (self.quantity_kind == "contracts") != (
                    self.contract_size_unit_id is not None and
                    self.contract_size_units is not None):
            raise FinanceError("replay receipt has ambiguous experimental action")
        numerator = native_int(self.price_numerator, positive=True)
        denominator = native_int(self.price_denominator, positive=True)
        if Fraction(numerator, denominator).numerator != numerator or \
                Fraction(numerator, denominator).denominator != denominator:
            raise FinanceError("replay price ratio must be reduced")
        if native_int(self.quantity_units, positive=True) > \
                native_int(self.desired_quantity_units, positive=True):
            raise FinanceError("replay receipt exceeds requested quantity")
        base_quantity = native_int(self.quantity_units, positive=True) * (
            native_int(self.contract_size_units, positive=True)
            if self.contract_size_units is not None else 1)
        if native_int(self.notional_units, positive=True) != \
                (base_quantity * numerator + denominator - 1) // denominator:
            raise FinanceError("replay executable notional differs from price ratio")
        if native_int(self.risk_notional_units, positive=True) < \
                native_int(self.notional_units, positive=True):
            raise FinanceError("replay risk notional understates executable notional")
        keys = tuple((part.capacity_key, part.asset_unit_id, part.location_id)
                     for part in self.components)
        if keys != tuple(sorted(set(keys))) or any(
                part.location_id != self.location_id or
                part.capacity_key != f"asset:{part.asset_unit_id}:{part.location_id}"
                for part in self.components):
            raise FinanceError("replay reservation components are ambiguous")
        envelope = self.execution_envelope
        if (self.position_state_hash is None) != (self.position_revision is None) or \
                (self.position_revision is not None and
                 self.position_revision <= 0) or \
                (self.code_version == "replay-sizing-v1" and
                 self.position_state_hash is not None):
            raise FinanceError("replay receipt has an invalid position anchor")
        if (self.position_state is None) != (self.position_state_hash is None):
            raise FinanceError("replay position anchor lacks immutable state")
        if self.position_state is not None and (
                self.position_state_hash != _digest(
                    "moeazi-position-arithmetic-v1",
                    self.position_state.model_dump(mode="json")) or
                self.position_state.scope != self.scope or
                self.position_state.run_id != self.run_id or
                self.position_state.instrument_version_id !=
                    self.instrument_version_id or
                self.position_state.location_id != self.location_id):
            raise FinanceError("replay position anchor differs from exact state")
        if self.code_version == "replay-sizing-v2" and \
                self.action in {"perp_reduce", "perp_close"} and \
                self.position_state is None:
            raise FinanceError("causal reduction lacks frozen position arithmetic")
        if (self.code_version == "replay-sizing-v2") != (envelope is not None):
            raise FinanceError("causal sizing receipt lacks an exact envelope")
        if envelope is not None:
            held = tuple((part.asset_unit_id, part.registry_hash,
                          part.location_id, part.units) for part in self.components)
            limits = tuple((row.asset_unit_id, row.registry_hash,
                            row.location_id, row.max_wallet_debit_units)
                           for row in envelope.liabilities)
            if envelope.scope != self.scope or envelope.run_id != self.run_id or \
                    envelope.manifest_hash != self.manifest_hash or \
                    envelope.decision_hash != self.decision_hash or \
                    envelope.selected_observation_hash != \
                        self.selected_observation_hash or \
                    envelope.account_snapshot_hash != self.account_snapshot_hash or \
                    envelope.account_revision != self.account_revision or \
                    envelope.instrument_version_id != self.instrument_version_id or \
                    envelope.instrument_registry_hash != self.instrument_registry_hash or \
                    envelope.action != self.action or envelope.side != self.side or \
                    envelope.quantity_kind != self.quantity_kind or \
                    envelope.location_id != self.location_id or \
                    envelope.issued_at_cursor != self.replay_cursor_at or \
                    envelope.max_quantity_units != self.quantity_units or \
                    envelope.position_state_hash != self.position_state_hash or \
                    envelope.position_revision != self.position_revision or \
                    (envelope.quantity_kind == "contracts" and (
                        envelope.collateral_loss_asset_unit_id !=
                            self.settlement_asset_unit_id or
                        envelope.collateral_loss_registry_hash !=
                            self.settlement_registry_hash)) or held != limits:
                raise FinanceError("causal envelope differs from held replay receipt")
        if self.receipt_hash != _digest("moeazi-" + self.code_version,
                self.model_dump(mode="json", exclude={"receipt_hash"})):
            raise FinanceError("replay sizing receipt hash differs")
        return self
