"""Causal simulation limits fixed from pre-dispatch evidence, never future books."""
from __future__ import annotations

from datetime import datetime
from fractions import Fraction
from typing import Literal

from pydantic import Field, StrictInt, field_validator, model_validator

from .finance_contracts import (
    FinanceError, FinanceScope, StrictFinanceModel, _digest, _hash, _utc,
    native_int,
)

CAUSAL_MODEL_VERSION = "moeazi-clob-linear-causal-v2"


class EnvelopeAssetLimit(StrictFinanceModel):
    """One held wallet pool; fee is a subset, never an added liability."""
    asset_unit_id: str = Field(min_length=1)
    registry_hash: str
    location_id: str = Field(min_length=1)
    max_wallet_debit_units: str
    max_fee_units: str

    @field_validator("registry_hash")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        return _hash(value)

    @field_validator("max_wallet_debit_units", "max_fee_units")
    @classmethod
    def valid_units(cls, value: str) -> str:
        native_int(value, nonnegative=True)
        return value

    @model_validator(mode="after")
    def fee_is_included(self):
        if native_int(self.max_wallet_debit_units, positive=True) < \
                native_int(self.max_fee_units, nonnegative=True):
            raise FinanceError("envelope fee cap exceeds its held wallet liability")
        return self


class ExecutionEnvelopeV1(StrictFinanceModel):
    schema_version: Literal[1]
    model_version: Literal["moeazi-clob-linear-causal-v2"]
    scope: FinanceScope
    run_id: str = Field(min_length=1)
    manifest_hash: str
    decision_hash: str
    selected_observation_hash: str
    account_snapshot_hash: str
    account_revision: str
    instrument_version_id: str = Field(min_length=1)
    instrument_registry_hash: str
    action: Literal["spot_buy", "spot_sell", "perp_open", "perp_increase",
                    "perp_reduce", "perp_close"]
    side: Literal["buy", "sell"]
    quantity_kind: Literal["asset_native", "contracts"]
    location_id: str = Field(min_length=1)
    issued_at_cursor: datetime
    accepted_at_cursor: datetime
    time_in_force_cursor: datetime
    limit_price_numerator: str
    limit_price_denominator: str
    max_quantity_units: str
    max_fill_events: StrictInt = Field(ge=1, le=64)
    liabilities: tuple[EnvelopeAssetLimit, ...] = Field(min_length=1)
    collateral_loss_asset_unit_id: str | None
    collateral_loss_registry_hash: str | None
    max_collateral_loss_units: str | None
    position_state_hash: str | None = Field(
        default=None, exclude_if=lambda value: value is None)
    position_revision: StrictInt | None = Field(
        default=None, exclude_if=lambda value: value is None)
    envelope_hash: str

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> int:
        if type(value) is not int or value != 1:
            raise FinanceError("execution envelope requires integer schema version 1")
        return value

    @field_validator("manifest_hash", "decision_hash", "selected_observation_hash",
                     "account_snapshot_hash", "instrument_registry_hash",
                     "collateral_loss_registry_hash", "position_state_hash",
                     "envelope_hash")
    @classmethod
    def valid_hash(cls, value: str | None) -> str | None:
        return _hash(value) if value is not None else None

    @field_validator("issued_at_cursor", "accepted_at_cursor", "time_in_force_cursor")
    @classmethod
    def valid_time(cls, value: datetime) -> datetime:
        return _utc(value)

    @field_validator("account_revision", "max_collateral_loss_units")
    @classmethod
    def nonnegative(cls, value: str | None) -> str | None:
        if value is not None:
            native_int(value, nonnegative=True)
        return value

    @field_validator("limit_price_numerator", "limit_price_denominator",
                     "max_quantity_units")
    @classmethod
    def positive(cls, value: str) -> str:
        native_int(value, positive=True)
        return value

    @model_validator(mode="after")
    def exact_envelope(self):
        if self.scope.environment != "experiment" or \
                not self.issued_at_cursor <= self.accepted_at_cursor < \
                    self.time_in_force_cursor or \
                (self.quantity_kind == "asset_native") != \
                    self.action.startswith("spot_") or \
                (self.action == "spot_buy" and self.side != "buy") or \
                (self.action == "spot_sell" and self.side != "sell"):
            raise FinanceError("execution envelope has ambiguous experimental order")
        price = Fraction(native_int(self.limit_price_numerator, positive=True),
                         native_int(self.limit_price_denominator, positive=True))
        if str(price.numerator) != self.limit_price_numerator or \
                str(price.denominator) != self.limit_price_denominator:
            raise FinanceError("envelope limit price ratio is not reduced")
        keys = tuple((row.asset_unit_id, row.registry_hash, row.location_id)
                     for row in self.liabilities)
        if keys != tuple(sorted(set(keys))) or any(
                row.location_id != self.location_id for row in self.liabilities):
            raise FinanceError("envelope liabilities need unique sorted registration")
        collateral = (self.collateral_loss_asset_unit_id,
                      self.collateral_loss_registry_hash,
                      self.max_collateral_loss_units)
        if self.quantity_kind == "contracts":
            if any(item is None for item in collateral):
                raise FinanceError("linear envelope lacks collateral-loss identity")
        elif any(item is not None for item in collateral):
            raise FinanceError("spot envelope cannot assert collateral-loss capacity")
        anchored = self.position_state_hash is not None and \
            self.position_revision is not None and self.position_revision > 0
        if self.action in {"perp_reduce", "perp_close"} and not anchored:
            raise FinanceError("linear reduction needs an immutable position anchor")
        if self.action in {"spot_buy", "perp_open"} and (
                self.position_state_hash is not None or
                self.position_revision is not None):
            raise FinanceError("increasing envelope cannot borrow position state")
        if (self.position_state_hash is None) != (self.position_revision is None):
            raise FinanceError("position anchor requires both hash and revision")
        if self.envelope_hash != _digest("moeazi-execution-envelope-v1",
                self.model_dump(mode="json", exclude={"envelope_hash"})):
            raise FinanceError("execution envelope content hash differs")
        return self
