"""Strict native-unit inputs for the PostgreSQL financial owner."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .controller_contracts import ControllerRef


class FinanceError(ValueError):
    """A financial command cannot be safely admitted."""


def native_int(value: str, *, positive: bool = False, nonnegative: bool = False) -> int:
    if not isinstance(value, str) or not value or len(value.lstrip("-")) > 78:
        raise FinanceError("native units require a bounded canonical integer string")
    if value == "-0" or (value[0] == "-" and value[1:].startswith("0")) \
            or (value.startswith("0") and value != "0"):
        raise FinanceError("native units are not canonical")
    digits = value[1:] if value.startswith("-") else value
    if not digits.isascii() or not digits.isdigit():
        raise FinanceError("native units require decimal digits")
    result = int(value)
    if positive and result <= 0 or nonnegative and result < 0:
        raise FinanceError("native units have invalid sign")
    return result


def db_native_int(value: Decimal | int | str) -> int:
    """Decode SQL numeric without trusting Decimal's scientific string rendering."""
    if isinstance(value, str):
        return native_int(value)
    if isinstance(value, bool) or not isinstance(value, (Decimal, int)):
        raise FinanceError("database native units have an invalid type")
    if isinstance(value, Decimal) and (not value.is_finite() or
                                       value != value.to_integral_value()):
        raise FinanceError("database native units are fractional or nonfinite")
    result = int(value)
    if abs(result) >= 10 ** 78:
        raise FinanceError("database native units exceed the exact bound")
    return result


def _hash(value: str) -> str:
    if not isinstance(value, str) or len(value) != 64 \
            or any(char not in "0123456789abcdef" for char in value):
        raise FinanceError("lowercase SHA-256 hash required")
    return value


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise FinanceError("financial timestamps require a timezone")
    return value.astimezone(timezone.utc)


def _digest(domain: str, value: dict) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"),
                     ensure_ascii=False, allow_nan=False)
    return sha256((domain + "\n" + raw).encode()).hexdigest()


def semantic_request_hash(operation: str, command: BaseModel) -> str:
    body = command.model_dump(mode="json", exclude={"request_hash", "expected_revision",
                                                    "writer_epoch", "authority_epoch",
                                                    "idempotency_key"})
    return _digest(f"moeazi-finance-command-v1:{operation}", body)


def source_event_digest(command: "JournalCommand") -> str:
    return _digest("moeazi-finance-source-event-v1", {
        "sourceOwner": command.source_owner, "sourceStream": command.source_stream,
        "sourceEventId": command.source_event_id,
        "sourceRevision": command.source_revision,
        "sourcePayloadHash": command.source_payload_hash,
        "kind": command.kind, "observedAt": command.observed_at.isoformat(),
    })


class StrictFinanceModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class FinanceScope(StrictFinanceModel):
    environment: Literal["live", "experiment"]
    scope_id: str = Field(min_length=1)
    strategy_account_id: str = Field(min_length=1)

    @model_validator(mode="after")
    def check_scope(self):
        if (self.environment == "live") != (self.scope_id == "live"):
            raise FinanceError("finance environment and scope disagree")
        return self


class JournalPosting(StrictFinanceModel):
    asset_unit_id: str = Field(min_length=1)
    registry_hash: str
    location_id: str = Field(min_length=1)
    book: Literal["wallet", "collateral", "transit", "external", "liability",
                  "pnl", "fees", "funding", "gas"]
    units: str

    @field_validator("units")
    @classmethod
    def units_valid(cls, value: str) -> str:
        if native_int(value) == 0:
            raise FinanceError("zero posting is prohibited")
        return value

    @field_validator("registry_hash")
    @classmethod
    def registry_valid(cls, value: str) -> str:
        return _hash(value)


class JournalCommand(StrictFinanceModel):
    scope: FinanceScope
    expected_revision: int = Field(ge=0)
    writer_epoch: int = Field(gt=0)
    idempotency_key: str = Field(min_length=1)
    request_hash: str
    source_owner: str = Field(min_length=1)
    source_stream: str = Field(min_length=1)
    source_event_id: str = Field(min_length=1)
    source_revision: str = Field(min_length=1)
    source_event_hash: str
    source_payload_hash: str
    kind: Literal["opening", "fill", "fee", "gas", "funding", "deposit",
                  "withdrawal", "transfer", "correction_reversal", "correction"]
    observed_at: datetime
    postings: tuple[JournalPosting, ...] = Field(min_length=2)
    reverses_transaction_id: str | None = None

    @field_validator("request_hash", "source_event_hash", "source_payload_hash")
    @classmethod
    def hashes_valid(cls, value: str) -> str:
        return _hash(value)

    @field_validator("observed_at")
    @classmethod
    def time_valid(cls, value: datetime) -> datetime:
        return _utc(value)

    @model_validator(mode="after")
    def correction_binding(self):
        if (self.kind == "correction_reversal") != (self.reverses_transaction_id is not None):
            raise FinanceError("correction reversal must bind the original transaction")
        if self.source_event_hash != source_event_digest(self):
            raise FinanceError("journal source event digest mismatch")
        if self.request_hash != semantic_request_hash("journal", self):
            raise FinanceError("journal request hash mismatch")
        return self


class ReservationComponent(StrictFinanceModel):
    capacity_key: str = Field(min_length=1)
    asset_unit_id: str = Field(min_length=1)
    registry_hash: str
    location_id: str = Field(min_length=1)
    units: str

    @field_validator("units")
    @classmethod
    def positive_units(cls, value: str) -> str:
        native_int(value, positive=True)
        return value

    @field_validator("registry_hash")
    @classmethod
    def registry_valid(cls, value: str) -> str:
        return _hash(value)


class ReserveCommand(StrictFinanceModel):
    scope: FinanceScope
    controller_ref: ControllerRef
    controller_mode: Literal["shadow", "insights", "approval_required", "autopilot"]
    expected_revision: int = Field(ge=0)
    writer_epoch: int = Field(gt=0)
    authority_epoch: int = Field(ge=0)
    authority_fingerprint: str
    idempotency_key: str = Field(min_length=1)
    request_hash: str
    intent_id: str = Field(min_length=1)
    purpose: Literal["trade", "withdrawal"]
    policy_version: str = Field(min_length=1)
    policy_hash: str
    snapshot_hash: str
    calculation_receipt_hash: str
    components: tuple[ReservationComponent, ...] = Field(min_length=1)
    expires_at: datetime

    @field_validator("request_hash", "snapshot_hash", "calculation_receipt_hash",
                     "policy_hash", "authority_fingerprint")
    @classmethod
    def hashes_valid(cls, value: str) -> str:
        return _hash(value)

    @field_validator("expires_at")
    @classmethod
    def time_valid(cls, value: datetime) -> datetime:
        return _utc(value)

    @model_validator(mode="after")
    def identity_matches(self):
        if self.controller_ref.strategyAccountId != self.scope.strategy_account_id \
                or self.controller_ref.environment != self.scope.environment:
            raise FinanceError("reservation controller and finance scope differ")
        if self.scope.environment == "experiment" and self.controller_mode == "insights":
            raise FinanceError("legacy insights mode cannot reserve simulation risk")
        if self.request_hash != semantic_request_hash("reserve", self):
            raise FinanceError("reservation request hash mismatch")
        return self


class ReconcileCommand(StrictFinanceModel):
    scope: FinanceScope
    expected_revision: int = Field(ge=0)
    writer_epoch: int = Field(gt=0)
    idempotency_key: str = Field(min_length=1)
    request_hash: str
    snapshot_hash: str
    policy_version: str = Field(min_length=1)
    policy_hash: str

    @field_validator("request_hash", "snapshot_hash", "policy_hash")
    @classmethod
    def hashes_valid(cls, value: str) -> str:
        return _hash(value)

    @model_validator(mode="after")
    def semantic_hash_valid(self):
        if self.request_hash != semantic_request_hash("reconcile", self):
            raise FinanceError("reconciliation request hash mismatch")
        return self


class CapacityBucket(StrictFinanceModel):
    capacity_key: str = Field(min_length=1)
    asset_unit_id: str = Field(min_length=1)
    registry_hash: str
    location_id: str = Field(min_length=1)
    limit_units: str

    @field_validator("limit_units")
    @classmethod
    def limit_valid(cls, value: str) -> str:
        native_int(value, nonnegative=True)
        return value

    @field_validator("registry_hash")
    @classmethod
    def registry_valid(cls, value: str) -> str:
        return _hash(value)
