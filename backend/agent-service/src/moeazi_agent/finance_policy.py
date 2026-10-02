"""Deterministic native-unit sizing baseline; policy values have no defaults."""
from __future__ import annotations

from hashlib import sha256
import json
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .finance_contracts import (
    FinanceError, ReservationComponent, StrictFinanceModel, native_int,
)


def _digest(prefix: str, value: dict) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256((prefix + "\n" + raw).encode()).hexdigest()


def _ceil_div(numerator: int, denominator: int) -> int:
    if denominator <= 0 or numerator < 0:
        raise FinanceError("invalid exact ratio")
    return (numerator + denominator - 1) // denominator


class SizingPolicy(StrictFinanceModel):
    policy_version: str = Field(min_length=1)
    policy_hash: str
    instrument_version_id: str = Field(min_length=1)
    max_quantity_units: str
    min_quantity_units: str
    quantity_step_units: str
    max_gross_notional_units: str
    max_directional_notional_units: str
    initial_margin_bps: int = Field(ge=0, le=10_000)
    fee_ceiling_units: str
    exit_buffer_units: str
    max_observation_age_seconds: int = Field(gt=0)
    max_reservation_seconds: int = Field(gt=0)
    approved_live: bool

    @field_validator("max_quantity_units", "min_quantity_units", "quantity_step_units",
                     "max_gross_notional_units", "max_directional_notional_units")
    @classmethod
    def positive(cls, value: str) -> str:
        native_int(value, positive=True)
        return value

    @field_validator("fee_ceiling_units", "exit_buffer_units")
    @classmethod
    def nonnegative(cls, value: str) -> str:
        native_int(value, nonnegative=True)
        return value

    @model_validator(mode="after")
    def verify_hash(self):
        body = self.model_dump(exclude={"policy_hash"})
        if self.policy_hash != _digest("moeazi-finance-policy-v1", body):
            raise FinanceError("finance policy hash mismatch")
        return self


class SizingRequest(StrictFinanceModel):
    action: Literal["spot_buy", "spot_sell", "perp_open"]
    instrument_version_id: str = Field(min_length=1)
    desired_quantity_units: str
    quantity_asset_unit_id: str = Field(min_length=1)
    quantity_registry_hash: str
    quote_asset_unit_id: str = Field(min_length=1)
    quote_registry_hash: str
    location_id: str = Field(min_length=1)
    quote_per_quantity_numerator: str
    quote_per_quantity_denominator: str
    price_snapshot_hash: str
    account_snapshot_hash: str
    existing_gross_notional_units: str
    existing_directional_notional_units: str

    @field_validator("desired_quantity_units", "quote_per_quantity_numerator",
                     "quote_per_quantity_denominator")
    @classmethod
    def positive(cls, value: str) -> str:
        native_int(value, positive=True)
        return value

    @field_validator("existing_gross_notional_units", "existing_directional_notional_units")
    @classmethod
    def nonnegative(cls, value: str) -> str:
        native_int(value, nonnegative=True)
        return value

    @field_validator("quantity_registry_hash", "quote_registry_hash",
                     "price_snapshot_hash", "account_snapshot_hash")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        if len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
            raise FinanceError("sizing reference hash is invalid")
        return value


class SizingReceipt(StrictFinanceModel):
    schema_version: Literal[1]
    code_version: Literal["finance-sizing-v1"]
    policy_version: str
    policy_hash: str
    account_revision: str
    price_snapshot_hash: str
    account_snapshot_hash: str
    action: Literal["spot_buy", "spot_sell", "perp_open"]
    instrument_version_id: str
    request: SizingRequest
    quantity_units: str
    notional_units: str
    components: tuple[ReservationComponent, ...]
    receipt_hash: str

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> int:
        if type(value) is not int or value != 1:
            raise FinanceError("sizing receipt schema version must be the integer 1")
        return value

    @field_validator("account_revision")
    @classmethod
    def revision_valid(cls, value: str) -> str:
        native_int(value, nonnegative=True)
        return value

    @model_validator(mode="after")
    def verify_hash(self):
        body = self.model_dump(exclude={"receipt_hash"})
        if self.receipt_hash != _digest("moeazi-finance-sizing-v1", body):
            raise FinanceError("sizing receipt hash mismatch")
        return self


def size_intent(policy: SizingPolicy, request: SizingRequest,
                account_revision: int) -> SizingReceipt:
    if account_revision < 0:
        raise FinanceError("sizing account revision is invalid")
    if request.instrument_version_id != policy.instrument_version_id:
        raise FinanceError("policy instrument does not match sizing request")
    desired = native_int(request.desired_quantity_units, positive=True)
    step = native_int(policy.quantity_step_units, positive=True)
    quantity = min(desired, native_int(policy.max_quantity_units, positive=True)) // step * step
    numerator = native_int(request.quote_per_quantity_numerator, positive=True)
    denominator = native_int(request.quote_per_quantity_denominator, positive=True)
    gross = native_int(request.existing_gross_notional_units, nonnegative=True)
    directional = native_int(request.existing_directional_notional_units, nonnegative=True)
    max_new = min(native_int(policy.max_gross_notional_units) - gross,
                  native_int(policy.max_directional_notional_units) - directional)
    if request.action != "spot_sell":
        if max_new <= 0:
            raise FinanceError("gross or directional exposure cap reached")
        quantity = min(quantity, (max_new * denominator // numerator) // step * step)
    if quantity < native_int(policy.min_quantity_units, positive=True):
        raise FinanceError("rounded quantity is below the policy minimum")
    notional = _ceil_div(quantity * numerator, denominator)
    if request.action != "spot_sell" and notional > max_new:
        raise FinanceError("rounded notional exceeds policy cap")
    fee = native_int(policy.fee_ceiling_units, nonnegative=True)
    exit_buffer = native_int(policy.exit_buffer_units, nonnegative=True)
    quote_key = f"asset:{request.quote_asset_unit_id}:{request.location_id}"
    quantity_key = f"asset:{request.quantity_asset_unit_id}:{request.location_id}"
    if request.action == "spot_buy":
        requirements = [(quote_key, request.quote_asset_unit_id,
                         request.quote_registry_hash, notional + fee + exit_buffer)]
    elif request.action == "spot_sell":
        requirements = [(quantity_key, request.quantity_asset_unit_id,
                         request.quantity_registry_hash, quantity),
                        (quote_key, request.quote_asset_unit_id,
                         request.quote_registry_hash, fee + exit_buffer)]
    else:
        margin = _ceil_div(notional * policy.initial_margin_bps, 10_000)
        if margin == 0:
            raise FinanceError("perpetual margin policy is missing")
        requirements = [(quote_key, request.quote_asset_unit_id,
                         request.quote_registry_hash, margin + fee + exit_buffer)]
    components = tuple(ReservationComponent(capacity_key=key, asset_unit_id=asset,
        registry_hash=registry, location_id=request.location_id, units=str(units))
        for key, asset, registry, units in requirements if units > 0)
    body = dict(schema_version=1, code_version="finance-sizing-v1",
                policy_version=policy.policy_version, policy_hash=policy.policy_hash,
                account_revision=str(account_revision),
                price_snapshot_hash=request.price_snapshot_hash,
                account_snapshot_hash=request.account_snapshot_hash,
                action=request.action, instrument_version_id=request.instrument_version_id,
                request=request.model_dump(),
                quantity_units=str(quantity), notional_units=str(notional),
                components=tuple(item.model_dump() for item in components))
    return SizingReceipt.model_validate({**body,
        "receipt_hash": _digest("moeazi-finance-sizing-v1", body)})
