"""Exact, source-attributed market observations; no financial settlement authority."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from fractions import Fraction
from typing import Literal

from pydantic import Field, StrictInt, field_validator, model_validator

from .contracts import StrictModel


HASH = re.compile(r"^[0-9a-f]{64}$")
DECIMAL = re.compile(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$")


def canonical_hash(value: object) -> str:
    body = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Timestamp must have an explicit UTC offset")
    return value.astimezone(timezone.utc)


class InstrumentVersion(StrictModel):
    instrument_version_id: str = Field(min_length=1)
    venue_id: str = Field(min_length=1)
    native_instrument_id: str = Field(min_length=1)
    product_kind: Literal["spot", "perpetual"]
    base_asset_unit_id: str = Field(min_length=1)
    quote_asset_unit_id: str = Field(min_length=1)
    settlement_asset_unit_id: str = Field(min_length=1)
    base_decimals: StrictInt = Field(ge=0, le=36)
    quote_decimals: StrictInt = Field(ge=0, le=36)
    settlement_decimals: StrictInt = Field(ge=0, le=36)
    size_decimals: StrictInt = Field(ge=0, le=36)
    contract_multiplier: str = Field(max_length=80)
    price_rule: str = Field(min_length=1)
    lot_step: str = Field(max_length=80)
    min_size: str | None = Field(default=None, max_length=80)
    margin_model: str = Field(min_length=1)
    funding_model: str = Field(min_length=1)
    effective_at: datetime
    registry_hash: str

    @field_validator("contract_multiplier", "lot_step", "min_size")
    @classmethod
    def exact_positive_decimal(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not DECIMAL.fullmatch(value) or not any(char in "123456789" for char in value):
            raise ValueError("Expected a positive plain decimal string")
        return value

    @field_validator("registry_hash")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        if not HASH.fullmatch(value):
            raise ValueError("Expected lowercase SHA-256")
        return value

    @field_validator("effective_at")
    @classmethod
    def valid_time(cls, value: datetime) -> datetime:
        return utc(value)

    @model_validator(mode="after")
    def valid_native_step(self):
        if Fraction(self.lot_step) % Fraction(1, 10 ** self.size_decimals):
            raise ValueError("Lot step is finer than native size precision")
        return self


class BookLevel(StrictModel):
    price_quote_per_base: str = Field(max_length=80)
    size_base: str = Field(max_length=80)

    @field_validator("price_quote_per_base", "size_base")
    @classmethod
    def exact_positive_decimal(cls, value: str) -> str:
        if not DECIMAL.fullmatch(value) or not any(char in "123456789" for char in value):
            raise ValueError("Book values must be positive plain decimal strings")
        return value


class MarketObservation(StrictModel):
    schema_version: Literal[1] = 1
    instrument_version_id: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    source_event_id: str = Field(min_length=1)
    source_kind: Literal["recorded_native", "synthetic_fault", "documented_example"]
    source_rights_ref: str = Field(min_length=1)
    raw_payload_hash: str
    observation_kind: Literal["book_snapshot"]
    event_at: datetime
    available_at: datetime
    received_at: datetime
    sequence: StrictInt | None = Field(default=None, ge=0)
    continuity: Literal["snapshot_only", "sequenced"]
    block_number: StrictInt | None = Field(default=None, ge=0)
    block_hash: str | None = None
    finality: Literal["not_applicable", "confirmed", "pending", "unknown", "reorged"]
    bids: tuple[BookLevel, ...]
    asks: tuple[BookLevel, ...]

    @field_validator("raw_payload_hash")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        if not HASH.fullmatch(value):
            raise ValueError("Expected lowercase SHA-256")
        return value

    @field_validator("schema_version", mode="before")
    @classmethod
    def strict_schema_version(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("schema_version must be an integer")
        return value

    @field_validator("event_at", "available_at", "received_at")
    @classmethod
    def valid_time(cls, value: datetime) -> datetime:
        return utc(value)

    @model_validator(mode="after")
    def valid_semantics(self):
        if self.continuity == "sequenced" and self.sequence is None:
            raise ValueError("Sequenced observation requires a sequence")
        if self.continuity == "snapshot_only" and self.sequence is not None:
            raise ValueError("Snapshot-only observation cannot claim a sequence")
        if self.block_number is not None and not self.block_hash:
            raise ValueError("Block number requires a block hash")
        if not self.bids or not self.asks:
            raise ValueError("Book must have both sides")
        return self


class ExcludedObservation(StrictModel):
    source_id: str
    source_event_id: str
    reason: str
    raw_payload_hash: str


class EvidenceSnapshot(StrictModel):
    schema_version: Literal[1] = 1
    cutoff_at: datetime
    instrument_version_ids: tuple[str, ...]
    accepted_observation_hashes: tuple[str, ...]
    excluded: tuple[ExcludedObservation, ...]
    source_rights_refs: tuple[str, ...]
    has_gap: bool
    snapshot_hash: str

    @field_validator("schema_version", mode="before")
    @classmethod
    def strict_schema_version(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("schema_version must be an integer")
        return value

    @field_validator("cutoff_at")
    @classmethod
    def valid_time(cls, value: datetime) -> datetime:
        return utc(value)


from .finance_observation_contracts import AccountObservationSnapshotRef, ObservedBalance, ObservedPosition  # noqa: E402
