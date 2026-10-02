"""Strict contracts for synthetic venue-price and liquidation receipts only."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from pydantic import Field, model_validator
from .contracts import StrictModel
from .venue_price_canonical import HASH, digest, integer, normal

ID = r"^[a-z][a-z0-9:_-]{2,100}$"


class Model(StrictModel):
    @model_validator(mode="before")
    @classmethod
    def canonical(cls, value: Any): normal(value); return value


class Bound(Model):
    @classmethod
    def bound(cls, item, field: str):
        if getattr(item, field) != digest(item.model_dump(exclude={field})):
            raise ValueError(f"{field} mismatch")
        return item


class ExactQuantity(Model):
    amount: str; unit_id: str = Field(pattern=ID); scale: int = Field(ge=0, le=36)
    signed: bool = False
    @model_validator(mode="after")
    def exact(self): integer(self.amount, signed=self.signed); return self


class VenuePriceScope(Bound):
    tenant_fingerprint: str = Field(pattern=ID); account_fingerprint: str = Field(pattern=ID)
    venue: Literal["hyperliquid_fixture", "gmx_fixture"]; venue_domain: Literal["hyperliquid_perp_fixture", "arbitrum_gmx_perp_fixture"]
    owner_provider: Literal["particle_fixture", "magic_fixture"]; owner_chain_id: int | None = None
    instrument_id: str = Field(pattern=ID); feature07_definition_hash: str; market_namespace: str = Field(pattern=ID)
    margin_mode: Literal["isolated", "cross"]; scope_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.feature07_definition_hash): raise ValueError("definition hash invalid")
        if self.venue_domain == "arbitrum_gmx_perp_fixture" and self.owner_chain_id != 42161: raise ValueError("EVM fixture needs Arbitrum")
        if self.venue_domain == "hyperliquid_perp_fixture" and self.owner_chain_id is not None: raise ValueError("Hyperliquid fixture has no EVM venue chain")
        return self.bound(self, "scope_hash")


class PriceSourceSpec(Bound):
    source_id: str = Field(pattern=ID); scope_hash: str; role: Literal["mark", "index", "oracle", "trigger", "liquidity", "funding", "fee"]
    unit_id: str = Field(pattern=ID); scale: int = Field(ge=0, le=36); independence_group: str = Field(pattern=ID)
    freshness_seconds: int = Field(ge=1, le=3600); source_revision: str = Field(pattern=ID); spec_hash: str
    @model_validator(mode="after")
    def valid(self): return self.bound(self, "spec_hash")


class PriceObservation(Bound):
    scope_hash: str; source_spec_hash: str; value: ExactQuantity; source_at: datetime; observed_at: datetime
    coordinate: str = Field(pattern=ID); predecessor_hash: str | None = None
    availability: Literal["available", "missing", "disputed"]; finality: Literal["final", "pending", "reorged"]
    anomaly: Literal["none", "jump", "repeat", "spoof", "reset"]; observation_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.source_spec_hash) or self.source_at > self.observed_at: raise ValueError("invalid observation binding")
        if self.predecessor_hash and not HASH.fullmatch(self.predecessor_hash): raise ValueError("bad predecessor")
        return self.bound(self, "observation_hash")


class VenuePriceSemantics(Bound):
    scope_hash: str; feature07_definition_hash: str; source_spec_hashes: list[str]; formula_revision: str = Field(pattern=ID)
    adapter_revision: str = Field(pattern=ID); config_revision: str = Field(pattern=ID); valid_from: datetime; valid_until: datetime
    divergence_ppm: int = Field(ge=0, le=1_000_000); semantics_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.source_spec_hashes != sorted(set(self.source_spec_hashes)) or not all(HASH.fullmatch(x) for x in self.source_spec_hashes): raise ValueError("source set invalid")
        if self.valid_from >= self.valid_until: raise ValueError("invalid half-open validity")
        return self.bound(self, "semantics_hash")


class Receipt(Bound):
    scope_hash: str; kind: Literal["margin", "funding", "constraint", "liquidity", "liquidation"]
    outcome: Literal["pass", "block", "unknown"]; reason_codes: list[str]; expires_at: datetime; input_hashes: list[str]; receipt_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.reason_codes != sorted(set(self.reason_codes)) or self.input_hashes != sorted(set(self.input_hashes)): raise ValueError("receipt sets invalid")
        if not all(HASH.fullmatch(item) for item in self.input_hashes): raise ValueError("receipt input invalid")
        return self.bound(self, "receipt_hash")


class Feature07Binding(Bound):
    scope_hash: str; definition_hash: str; control_hash: str; status: Literal["requires_revalidation"]; binding_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.definition_hash, self.control_hash)): raise ValueError("binding invalid")
        return self.bound(self, "binding_hash")


class PriceSafetyDecision(Bound):
    scope_hash: str; operation: str; outcome: Literal["pass", "close_only", "block", "unknown"]
    safe_lanes: list[str]; reason_codes: list[str]; receipt_hashes: list[str]; expires_at: datetime
    request_hash: str; idempotency_key: str = Field(min_length=8, max_length=96); decision_hash: str
    @model_validator(mode="after")
    def valid(self):
        for values in (self.safe_lanes, self.reason_codes, self.receipt_hashes):
            if values != sorted(set(values)): raise ValueError("decision sets invalid")
        if self.outcome == "pass" and (self.reason_codes or self.safe_lanes): raise ValueError("pass cannot carry degradation")
        if self.outcome != "close_only" and self.safe_lanes: raise ValueError("safe lanes require close-only")
        if not HASH.fullmatch(self.request_hash) or not all(HASH.fullmatch(x) for x in self.receipt_hashes): raise ValueError("decision hash invalid")
        return self.bound(self, "decision_hash")
