"""Exact experimental position arithmetic values; no persisted ledger authority."""
from __future__ import annotations

from fractions import Fraction
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .finance_contracts import FinanceError, FinanceScope, StrictFinanceModel, _hash, native_int


class AssetTotal(StrictFinanceModel):
    asset_unit_id: str = Field(min_length=1)
    registry_hash: str
    signed_units: str

    @field_validator("registry_hash")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        return _hash(value)

    @field_validator("signed_units")
    @classmethod
    def units_valid(cls, value: str) -> str:
        native_int(value)
        return value


class AssetBookDelta(StrictFinanceModel):
    asset_unit_id: str = Field(min_length=1)
    registry_hash: str
    location_id: str = Field(min_length=1)
    book: Literal["wallet", "collateral"]
    units: str

    @field_validator("registry_hash")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        return _hash(value)

    @field_validator("units")
    @classmethod
    def units_valid(cls, value: str) -> str:
        if native_int(value) == 0:
            raise FinanceError("zero economic delta must be omitted")
        return value


def exact_pair(numerator: str, denominator: str) -> Fraction:
    value = Fraction(native_int(numerator), native_int(denominator, positive=True))
    if str(value.numerator) != numerator or str(value.denominator) != denominator:
        raise FinanceError("rational amount must be reduced and canonical")
    return value


class PositionArithmeticState(StrictFinanceModel):
    scope: FinanceScope
    run_id: str = Field(min_length=1)
    instrument_version_id: str = Field(min_length=1)
    instrument_registry_hash: str
    location_id: str = Field(min_length=1)
    quantity_kind: Literal["asset_native", "contracts"]
    base_asset_unit_id: str = Field(min_length=1)
    base_registry_hash: str
    settlement_asset_unit_id: str = Field(min_length=1)
    settlement_registry_hash: str
    signed_quantity_units: str
    contract_size_unit_id: str | None
    contract_size_units: str | None
    open_cost_numerator: str
    open_cost_denominator: str
    realized_pnl_numerator: str
    realized_pnl_denominator: str
    unrealized_pnl_numerator: str
    unrealized_pnl_denominator: str
    mark_price_numerator: str | None
    mark_price_denominator: str | None
    margin_reserved_units: str
    collateral_units: str
    fee_totals: tuple[AssetTotal, ...] = ()
    funding_totals: tuple[AssetTotal, ...] = ()

    @field_validator("instrument_registry_hash", "base_registry_hash",
                     "settlement_registry_hash")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        return _hash(value)

    @field_validator("signed_quantity_units", "collateral_units", "margin_reserved_units",
                     "contract_size_units")
    @classmethod
    def unit_valid(cls, value: str | None) -> str | None:
        if value is not None:
            native_int(value)
        return value

    @model_validator(mode="after")
    def coherent_state(self):
        if self.scope.environment != "experiment" or \
                (self.quantity_kind == "contracts") != (self.contract_size_unit_id is not None
                 and self.contract_size_units is not None):
            raise FinanceError("position state lacks experimental quantity identity")
        if self.quantity_kind == "asset_native" and native_int(self.signed_quantity_units) < 0:
            raise FinanceError("Q4 spot inventory cannot be short")
        if native_int(self.collateral_units, nonnegative=True) < 0 or \
                native_int(self.margin_reserved_units, nonnegative=True) < 0:
            raise FinanceError("position state has negative collateral or margin")
        cost = exact_pair(self.open_cost_numerator, self.open_cost_denominator)
        exact_pair(self.realized_pnl_numerator, self.realized_pnl_denominator)
        exact_pair(self.unrealized_pnl_numerator, self.unrealized_pnl_denominator)
        if cost < 0 or (native_int(self.signed_quantity_units) == 0 and cost != 0):
            raise FinanceError("position cost basis disagrees with open quantity")
        if (self.mark_price_numerator is None) != (self.mark_price_denominator is None):
            raise FinanceError("position mark needs numerator and denominator")
        if self.mark_price_numerator is not None:
            if exact_pair(self.mark_price_numerator,
                          self.mark_price_denominator or "0") <= 0:
                raise FinanceError("position mark must be positive")
        for group in (self.fee_totals, self.funding_totals):
            keys = tuple((row.asset_unit_id, row.registry_hash) for row in group)
            if keys != tuple(sorted(set(keys))):
                raise FinanceError("asset totals require unique sorted identities")
        if any(native_int(row.signed_units) < 0 for row in self.fee_totals):
            raise FinanceError("fee totals cannot be negative")
        return self


class FillEffect(StrictFinanceModel):
    new_state: PositionArithmeticState
    deltas: tuple[AssetBookDelta, ...]
    realized_pnl_delta_numerator: str
    realized_pnl_delta_denominator: str
    unrealized_pnl_numerator: str
    unrealized_pnl_denominator: str
    collateral_delta_units: str
    unsupported_reason: str | None = None

    @model_validator(mode="after")
    def exact_effect(self):
        exact_pair(self.realized_pnl_delta_numerator, self.realized_pnl_delta_denominator)
        exact_pair(self.unrealized_pnl_numerator, self.unrealized_pnl_denominator)
        native_int(self.collateral_delta_units)
        return self
