"""Strict, local-only canonical instrument lifecycle records.

This module never resolves a live venue symbol, calls a network, or authorizes a
product operation.  It makes fixture identity ambiguity explicit instead.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from .contracts import StrictModel

HASH = re.compile(r"^[a-f0-9]{64}$")
ADDRESS = re.compile(r"^0x[a-f0-9]{40}$")


def _normal(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
            raise ValueError("timestamps must be UTC")
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, BaseModel):
        return _normal(value.model_dump(mode="python", exclude_none=False))
    if isinstance(value, dict):
        if any(type(key) is not str for key in value): raise ValueError("canonical keys must be strings")
        return {key: _normal(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)): return [_normal(item) for item in value]
    if isinstance(value, float): raise ValueError("instrument contracts prohibit floats")
    return value


def canonical_json(value: Any) -> bytes:
    return json.dumps(_normal(value), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()


def digest(value: Any) -> str: return sha256(canonical_json(value)).hexdigest()


class InstrumentModel(StrictModel):
    @model_validator(mode="before")
    @classmethod
    def strict_values(cls, value: Any): _normal(value); return value


class RegistryScope(InstrumentModel):
    tenant_id: str = Field(pattern=r"^tenant:[a-z0-9_-]{2,64}$")
    account_id: str | None = Field(default=None, pattern=r"^account:[a-z0-9_-]{2,64}$")
    venue: Literal["hyperliquid", "gmx", "uniswap"]
    environment: Literal["hyperliquid-mainnet", "arbitrum-mainnet"]
    namespace: str = Field(pattern=r"^[a-z0-9_-]{2,64}$")


class Rational(InstrumentModel):
    numerator: int = Field(ge=1, le=10**18)
    denominator: int = Field(ge=1, le=10**18)

    @model_validator(mode="after")
    def reduced(self):
        from math import gcd
        if gcd(self.numerator, self.denominator) != 1: raise ValueError("rational must be reduced")
        return self


class NativeInstrumentIdentity(InstrumentModel):
    venue: Literal["hyperliquid", "gmx", "uniswap"]
    environment: Literal["hyperliquid-mainnet", "arbitrum-mainnet"]
    chain_id: int | None = None
    namespace: str = Field(pattern=r"^[a-z0-9_-]{2,64}$")
    kind: Literal["spot", "perpetual", "future", "amm_pool"]
    native_id: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9:._-]+$")
    universe_revision: str = Field(min_length=3, max_length=80)
    metadata_revision: str = Field(min_length=3, max_length=80)
    identity_hash: str

    @model_validator(mode="after")
    def valid(self):
        arb = self.environment == "arbitrum-mainnet"
        if arb != (self.chain_id == 42161): raise ValueError("Arbitrum identity must bind chain 42161")
        if arb and self.kind == "amm_pool" and not ADDRESS.fullmatch(self.native_id):
            raise ValueError("Arbitrum pool identity must be lowercase address")
        if not HASH.fullmatch(self.identity_hash) or self.identity_hash != digest(self.model_dump(exclude={"identity_hash"})):
            raise ValueError("native identity hash mismatch")
        return self


class AssetIdentity(InstrumentModel):
    asset_id: str = Field(pattern=r"^[A-Za-z0-9:._-]{3,120}$")
    asset_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.asset_hash) or self.asset_hash != digest(self.model_dump(exclude={"asset_hash"})): raise ValueError("asset hash mismatch")
        return self


class DefinitionAssetRole(InstrumentModel):
    role: Literal["base", "quote", "settlement"]
    asset_hash: str

    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.asset_hash): raise ValueError("asset role hash is invalid")
        return self


class InstrumentDefinitionVersion(InstrumentModel):
    stable_id: str = Field(pattern=r"^instrument:[a-z0-9_-]{3,80}$")
    version: int = Field(ge=1, le=1000000)
    predecessor_hash: str | None = None
    identity_hash: str
    asset_roles: list[DefinitionAssetRole] = Field(min_length=3, max_length=3)
    kind: Literal["spot", "perpetual", "future", "amm_pool"]
    multiplier: Rational
    tick: Rational
    lot: Rational
    precision: int = Field(ge=0, le=36)
    status: Literal["active", "paused", "halted", "reduce_only", "expiring", "delisting", "settled", "delisted", "unknown", "disputed", "rebaseline_required"]
    effective_from: datetime
    effective_until: datetime | None = None
    source_evidence_hash: str
    definition_hash: str

    @model_validator(mode="after")
    def valid(self):
        roles = [item.role for item in self.asset_roles]
        if roles != ["base", "quote", "settlement"]: raise ValueError("asset roles must be canonical and complete")
        if self.asset_roles[0].asset_hash == self.asset_roles[1].asset_hash:
            raise ValueError("base and quote assets must be distinct")
        if self.effective_until and self.effective_until <= self.effective_from: raise ValueError("invalid effective interval")
        fields = {"definition_hash", "predecessor_hash"}
        if not all(HASH.fullmatch(item) for item in [self.identity_hash, self.source_evidence_hash]): raise ValueError("invalid definition binding")
        if self.predecessor_hash and not HASH.fullmatch(self.predecessor_hash): raise ValueError("invalid predecessor")
        if self.definition_hash != digest(self.model_dump(exclude=fields - {"predecessor_hash"})): raise ValueError("definition hash mismatch")
        return self


class InstrumentAlias(InstrumentModel):
    scope: RegistryScope
    alias: str = Field(pattern=r"^[A-Za-z0-9._/-]{1,80}$")
    target_definition_hash: str
    valid_from: datetime
    valid_until: datetime
    precedence: int = Field(ge=0, le=100)
    alias_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.valid_until <= self.valid_from or self.alias_hash != digest(self.model_dump(exclude={"alias_hash"})): raise ValueError("alias invalid")
        return self


class InstrumentLifecycleEvent(InstrumentModel):
    event_id: str = Field(pattern=r"^[a-z0-9:_-]{3,100}$")
    scope: RegistryScope
    native_sequence: int = Field(ge=0)
    event_type: Literal["status", "terms", "rename", "correction", "supersession"]
    old_definition_hash: str | None = None
    new_definition_hash: str | None = None
    effective_at: datetime
    observed_at: datetime
    source_evidence_hash: str
    supersedes_event_hash: str | None = None
    event_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.observed_at < self.effective_at or not HASH.fullmatch(self.source_evidence_hash):
            raise ValueError("event evidence is invalid")
        if self.event_type in {"status", "terms"} and (not self.old_definition_hash or not self.new_definition_hash):
            raise ValueError("lifecycle change must bind both definitions")
        if self.event_type in {"correction", "supersession"} and not self.supersedes_event_hash:
            raise ValueError("replacement event must bind its predecessor")
        if any(value is not None and not HASH.fullmatch(value) for value in
               (self.old_definition_hash, self.new_definition_hash, self.supersedes_event_hash)):
            raise ValueError("event reference hash is invalid")
        if self.event_hash != digest(self.model_dump(exclude={"event_hash"})): raise ValueError("event hash mismatch")
        return self


class ContinuityTransform(InstrumentModel):
    continuity: Literal["same", "successor", "redenomination", "split", "migration", "no_continuity", "unknown"]
    old_definition_hash: str
    new_definition_hash: str
    factor: Rational | None = None
    reviewer_role: Literal["fixture_reviewer"]
    reviewed: bool
    evidence_hash: str
    transform_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.old_definition_hash == self.new_definition_hash or not all(HASH.fullmatch(item) for item in
                (self.old_definition_hash, self.new_definition_hash, self.evidence_hash)):
            raise ValueError("transform bindings are invalid")
        if self.continuity in {"split", "redenomination"} and self.factor is None:
            raise ValueError("economic transform requires a factor")
        if self.continuity in {"no_continuity", "unknown"} and self.factor is not None:
            raise ValueError("non-continuity transform cannot carry a factor")
        if self.transform_hash != digest(self.model_dump(exclude={"transform_hash"})): raise ValueError("transform hash mismatch")
        return self


class InstrumentOperationDecision(InstrumentModel):
    operation: str = Field(pattern=r"^[a-z_]{3,40}$")
    scope: RegistryScope
    stable_id: str | None = None
    definition_hash: str | None = None
    snapshot_hash: str
    event_watermark: int = Field(ge=0)
    outcome: Literal["allow", "block", "unknown", "safe_only"]
    reasons: list[str] = Field(max_length=12)
    permitted_lanes: list[str] = Field(max_length=8)
    expires_at: datetime
    idempotency_key: str = Field(min_length=8, max_length=96, pattern=r"^[A-Za-z0-9._:-]+$")
    request_hash: str
    decision_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.reasons != sorted(set(self.reasons)) or self.permitted_lanes != sorted(set(self.permitted_lanes)): raise ValueError("decision lists must be sorted")
        if not all(HASH.fullmatch(item) for item in (self.snapshot_hash, self.request_hash, self.decision_hash)):
            raise ValueError("decision identity hash is invalid")
        if self.outcome == "allow" and self.reasons:
            raise ValueError("allow decision cannot carry unresolved reasons")
        if self.decision_hash != digest(self.model_dump(exclude={"decision_hash"})): raise ValueError("decision hash mismatch")
        return self
