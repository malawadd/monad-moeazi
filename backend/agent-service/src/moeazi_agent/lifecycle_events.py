"""Immutable simulator events with exact native units and source identity."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .finance_contracts import FinanceError, FinanceScope, StrictFinanceModel, _digest, _hash, _utc, native_int
from .lifecycle_execution_envelope import CAUSAL_MODEL_VERSION


def _version(value: object) -> int:
    if type(value) is not int or value != 1:
        raise FinanceError("lifecycle schema version must be the integer 1")
    return value


class ExecutionEvent(StrictFinanceModel):
    """Price ratio is quote/settlement native units per base native unit."""
    schema_version: Literal[1]
    scope: FinanceScope
    run_id: str = Field(min_length=1)
    run_manifest_hash: str
    scenario_hash: str
    simulation_model_version: str = Field(min_length=1)
    dataset_hash: str
    instrument_version_id: str = Field(min_length=1)
    order_id: str = Field(min_length=1)
    order_ordinal: int = Field(gt=0)
    client_id: str = Field(min_length=1)
    attempt_id: str = Field(min_length=1)
    permit_hash: str
    source_stream: str = Field(min_length=1)
    source_event_id: str = Field(min_length=1)
    source_revision: str = Field(min_length=1)
    sequence: int = Field(ge=0)
    kind: Literal["accepted", "ack_lost", "fill", "cancel_requested", "cancelled",
                  "rejected", "protection_accepted", "protection_rejected",
                  "funding", "mark", "liquidation"]
    quantity_kind: Literal["asset_native", "contracts"]
    contract_size_unit_id: str | None
    contract_size_units: str | None
    event_at: datetime
    available_at: datetime
    simulation_cursor_at: datetime
    fill_quantity_units: str | None
    cumulative_filled_units: str
    price_numerator: str | None
    price_denominator: str | None
    fee_asset_unit_id: str | None
    fee_registry_hash: str | None
    fee_units: str | None
    funding_asset_unit_id: str | None
    funding_registry_hash: str | None
    funding_units: str | None
    protection_order_id: str | None
    observation_hash: str | None
    observation_source_kind: Literal["recorded_native", "synthetic_fault",
                                     "documented_example"] | None = None
    terminal_reason: Literal["time_in_force_expired", "residual_time_in_force",
                             "price_limit_unfilled", "envelope_exhausted"] | None = Field(
        default=None, exclude_if=lambda value: value is None)
    source_payload_hash: str
    event_hash: str

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> int:
        return _version(value)

    @field_validator("run_manifest_hash", "scenario_hash", "dataset_hash", "permit_hash",
                     "source_payload_hash", "event_hash", "observation_hash", "fee_registry_hash",
                     "funding_registry_hash")
    @classmethod
    def hash_valid(cls, value: str | None) -> str | None:
        return _hash(value) if value is not None else None

    @field_validator("event_at", "available_at", "simulation_cursor_at")
    @classmethod
    def time_valid(cls, value: datetime) -> datetime:
        return _utc(value)

    @field_validator("cumulative_filled_units", "fill_quantity_units", "fee_units",
                     "contract_size_units")
    @classmethod
    def nonnegative_units(cls, value: str | None) -> str | None:
        if value is not None:
            native_int(value, nonnegative=True)
        return value

    @field_validator("funding_units")
    @classmethod
    def signed_units(cls, value: str | None) -> str | None:
        if value is not None:
            native_int(value)
        return value

    @field_validator("price_numerator", "price_denominator")
    @classmethod
    def positive_ratio(cls, value: str | None) -> str | None:
        if value is not None:
            native_int(value, positive=True)
        return value

    @model_validator(mode="after")
    def check_event(self):
        if self.scope.environment != "experiment" or not (
                self.event_at <= self.available_at <= self.simulation_cursor_at):
            raise FinanceError("execution event is outside its simulation cursor")
        if self.kind == "fill" and (self.fill_quantity_units is None or
                native_int(self.fill_quantity_units) == 0 or
                self.price_numerator is None or self.price_denominator is None or
                self.observation_hash is None or self.observation_source_kind is None):
            raise FinanceError("fill lacks exact quantity or price")
        if (self.price_numerator is None) != (self.price_denominator is None) or \
                (self.fee_asset_unit_id is None) != (self.fee_units is None) or \
                (self.funding_asset_unit_id is None) != (self.funding_units is None) or \
                (self.fee_asset_unit_id is None) != (self.fee_registry_hash is None) or \
                (self.funding_asset_unit_id is None) != (self.funding_registry_hash is None):
            raise FinanceError("event amount lacks its unit or denominator")
        if self.quantity_kind == "contracts" and (not self.contract_size_unit_id or
                self.contract_size_units is None or native_int(self.contract_size_units) == 0):
            raise FinanceError("contract event lacks immutable contract size unit")
        if self.quantity_kind == "asset_native" and (self.contract_size_unit_id is not None
                or self.contract_size_units is not None):
            raise FinanceError("asset-native event cannot carry contract size")
        if self.kind != "fill" and self.fill_quantity_units is not None or \
                self.kind not in {"fill", "mark"} and self.price_numerator is not None or \
                self.kind != "fill" and self.fee_units is not None or \
                self.kind != "funding" and self.funding_units is not None:
            raise FinanceError("event carries an amount outside its economic kind")
        if self.kind == "funding" and self.funding_units is None:
            raise FinanceError("funding event lacks exact signed amount")
        if self.kind.startswith("protection_") and not self.protection_order_id:
            raise FinanceError("protective event lacks protective order identity")
        if self.terminal_reason is not None and (self.kind != "cancelled" or
                self.simulation_model_version != CAUSAL_MODEL_VERSION):
            raise FinanceError("TIF reason requires a causal cancellation fact")
        if self.kind == "cancelled" and self.simulation_model_version == \
                CAUSAL_MODEL_VERSION and self.source_stream in {
                    "moeazi_simulation_causal_v2",
                    "moeazi_simulation_causal_synthetic_v2"} and \
                self.terminal_reason is None:
            raise FinanceError("causal source terminal lacks its TIF reason")
        body = self.model_dump(mode="json", exclude={"event_hash"})
        if self.event_hash != _digest("moeazi-execution-event-v1", body):
            raise FinanceError("execution event content hash differs")
        return self
