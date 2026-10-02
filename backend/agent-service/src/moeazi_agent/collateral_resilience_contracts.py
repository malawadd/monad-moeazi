"""Strict synthetic collateral and exit-capacity contracts; never product inputs."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from pydantic import Field, model_validator
from .contracts import StrictModel
from .collateral_resilience_canonical import HASH, digest, integer, normal

ID = r"^[a-z][a-z0-9:_-]{2,100}$"

class Model(StrictModel):
    @model_validator(mode="before")
    @classmethod
    def canonical(cls, value: Any): normal(value); return value

class ExactQuantity(Model):
    amount: str; unit_id: str = Field(pattern=ID); scale: int = Field(ge=0, le=36); signed: bool = False
    @model_validator(mode="after")
    def valid(self): integer(self.amount, signed=self.signed); return self
    def value(self) -> int: return integer(self.amount, signed=self.signed)

class CollateralScope(Model):
    tenant_fingerprint: str = Field(pattern=ID); account_fingerprint: str = Field(pattern=ID)
    owner_provider: Literal["particle_fixture", "magic_fixture"]; chain_id: Literal[42161, 0]
    venue_domain: Literal["arbitrum_fixture", "non_evm_fixture"]; instrument_id: str = Field(pattern=ID)
    margin_mode: Literal["isolated", "cross"]; feature12_binding_hash: str; scope_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.feature12_binding_hash) or self.scope_hash != digest(self.model_dump(exclude={"scope_hash"})): raise ValueError("scope hash invalid")
        if (self.venue_domain == "arbitrum_fixture") != (self.chain_id == 42161): raise ValueError("domain chain mismatch")
        return self

class DependencyObservation(Model):
    scope_hash: str; dependency_id: str = Field(pattern=ID); relation: Literal["issuer", "bridge", "wrapper", "custodian", "venue"]
    state: Literal["operational", "degraded", "halted", "disputed", "unknown"]; capacity: ExactQuantity | None = None
    observed_at: datetime; expires_at: datetime; predecessor_hash: str | None = None; observation_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.expires_at <= self.observed_at or (self.predecessor_hash and not HASH.fullmatch(self.predecessor_hash)): raise ValueError("dependency bounds invalid")
        if self.observation_hash != digest(self.model_dump(exclude={"observation_hash"})): raise ValueError("dependency hash mismatch")
        return self

class CollateralAssetSpec(Model):
    scope_hash: str; asset_id: str = Field(pattern=ID); identity: str = Field(pattern=ID); decimals: int = Field(ge=0, le=36)
    role: Literal["collateral", "index", "settlement"]; unit_id: str = Field(pattern=ID); dependency_hashes: list[str]
    valid_from: datetime; valid_until: datetime; spec_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.dependency_hashes != sorted(set(self.dependency_hashes)) or not all(HASH.fullmatch(x) for x in self.dependency_hashes): raise ValueError("asset dependency closure invalid")
        if self.valid_from >= self.valid_until or self.spec_hash != digest(self.model_dump(exclude={"spec_hash"})): raise ValueError("asset spec invalid")
        return self

class CollateralBalanceObservation(Model):
    scope_hash: str; asset_spec_hash: str; total: ExactQuantity; free: ExactQuantity; locked: ExactQuantity; encumbered: ExactQuantity; pending: ExactQuantity; withdrawable_now: ExactQuantity; queued: ExactQuantity
    observed_at: datetime; expires_at: datetime; observation_hash: str
    @model_validator(mode="after")
    def valid(self):
        values = [self.total, self.free, self.locked, self.encumbered, self.pending, self.withdrawable_now, self.queued]
        if len({(x.unit_id, x.scale) for x in values}) != 1 or any(x.value() < 0 for x in values): raise ValueError("balance unit invalid")
        if sum(x.value() for x in values[1:4]) > self.total.value() or self.withdrawable_now.value() + self.queued.value() > self.total.value(): raise ValueError("balance categories overlap")
        if self.expires_at <= self.observed_at or not HASH.fullmatch(self.asset_spec_hash) or self.observation_hash != digest(self.model_dump(exclude={"observation_hash"})): raise ValueError("balance invalid")
        return self

class PositionExposureObservation(Model):
    scope_hash: str; side: Literal["long", "short"]; size: ExactQuantity; notional: ExactQuantity; maintenance: ExactQuantity; mark: ExactQuantity
    observed_at: datetime; expires_at: datetime; observation_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.expires_at <= self.observed_at or self.observation_hash != digest(self.model_dump(exclude={"observation_hash"})): raise ValueError("position invalid")
        return self

class FundingBorrowObservation(Model):
    scope_hash: str; payable: ExactQuantity; borrow_principal: ExactQuantity; accrued_borrow: ExactQuantity; close_fee: ExactQuantity; settlement_fee: ExactQuantity
    interval_from: datetime; interval_until: datetime; expires_at: datetime; observation_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.interval_from >= self.interval_until or self.expires_at <= self.interval_until or self.observation_hash != digest(self.model_dump(exclude={"observation_hash"})): raise ValueError("funding bounds invalid")
        return self

class ExitLiquidityObservation(Model):
    scope_hash: str; close_side: Literal["sell", "buy"]; capacity: ExactQuantity; requested: ExactQuantity; impact_bps: int = Field(ge=0, le=10_000)
    maximum_impact_bps: int = Field(ge=0, le=10_000); observed_at: datetime; expires_at: datetime; state: Literal["available", "missing", "disputed", "nonfinal"]; observation_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.capacity.unit_id != self.requested.unit_id or self.capacity.scale != self.requested.scale or self.expires_at <= self.observed_at or self.observation_hash != digest(self.model_dump(exclude={"observation_hash"})): raise ValueError("liquidity invalid")
        return self

class Feature12Binding(Model):
    scope_hash: str; control_hash: str; run_hash: str; bundle_hash: str; status: Literal["requires_revalidation"]; binding_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.control_hash, self.run_hash, self.bundle_hash)) or self.binding_hash != digest(self.model_dump(exclude={"binding_hash"})): raise ValueError("feature 12 binding invalid")
        return self

class CollateralRiskEnvelope(Model):
    scope_hash: str; operation: str; outcome: Literal["pass", "close_only", "block", "unknown"]; reason_codes: list[str]; safe_lanes: list[str]
    stressed_surplus: str; exit_capacity: str; maximum_increase: str; receipt_hashes: list[str]; expires_at: datetime; request_hash: str; envelope_hash: str
    @model_validator(mode="after")
    def valid(self):
        for values in (self.reason_codes, self.safe_lanes, self.receipt_hashes):
            if values != sorted(set(values)): raise ValueError("unordered envelope set")
        if self.outcome == "pass" and (self.reason_codes or self.safe_lanes): raise ValueError("pass cannot degrade")
        if self.outcome != "close_only" and self.safe_lanes: raise ValueError("safe lanes only close-only")
        if not HASH.fullmatch(self.request_hash) or not all(HASH.fullmatch(x) for x in self.receipt_hashes): raise ValueError("envelope inputs invalid")
        for field in ("stressed_surplus", "exit_capacity", "maximum_increase"): integer(getattr(self, field), signed=field == "stressed_surplus")
        if self.envelope_hash != digest(self.model_dump(exclude={"envelope_hash"})): raise ValueError("envelope hash mismatch")
        return self
