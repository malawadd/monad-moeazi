"""Strict fixture-only temporal integrity contracts.

These records model uncertainty and causal evidence.  They do not provide time,
sign, contact a venue, or alter product authority.
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


def _normal(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
            raise ValueError("temporal timestamps must be UTC")
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, BaseModel): return _normal(value.model_dump(mode="python", exclude_none=False))
    if isinstance(value, dict):
        if any(type(key) is not str for key in value): raise ValueError("canonical keys must be strings")
        return {key: _normal(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)): return [_normal(item) for item in value]
    if isinstance(value, float): raise ValueError("temporal contracts prohibit floats")
    return value


def canonical_json(value: Any) -> bytes:
    return json.dumps(_normal(value), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()


def digest(value: Any) -> str: return sha256(canonical_json(value)).hexdigest()


class TemporalModel(StrictModel):
    @model_validator(mode="before")
    @classmethod
    def _strict(cls, value: Any): _normal(value); return value


class TemporalScope(TemporalModel):
    key: str = Field(pattern=r"^(shared|tenant:[a-z0-9_-]+|account:[a-z0-9_-]+|signer:[a-f0-9]{16,64})$")


class ClockDomainSpec(TemporalModel):
    schema_version: Literal[1] = 1
    domain_id: str = Field(pattern=r"^[a-z][a-z0-9_-]{2,79}$")
    domain_type: Literal["wall_utc", "monotonic", "workflow", "chain", "venue_sequence", "budget_epoch"]
    owner: Literal["local_fixture"] = "local_fixture"
    epoch: int = Field(ge=0)
    allowed_operations: list[str] = Field(min_length=1, max_length=16)
    max_uncertainty_us: int = Field(ge=0, le=86_400_000_000)
    max_age_us: int = Field(ge=1, le=86_400_000_000)
    decision_ttl_us: int = Field(ge=1, le=86_400_000_000)
    spec_hash: str

    @model_validator(mode="after")
    def valid_hash_and_values(self):
        if self.allowed_operations != sorted(set(self.allowed_operations)): raise ValueError("operations must be sorted")
        if not HASH.fullmatch(self.spec_hash) or self.spec_hash != digest(self.model_dump(exclude={"spec_hash"})):
            raise ValueError("clock spec hash mismatch")
        return self


class TimeHealthObservation(TemporalModel):
    domain_id: str
    spec_hash: str
    scope: TemporalScope
    epoch: int = Field(ge=0)
    earliest_us: int = Field(ge=0)
    latest_us: int = Field(ge=0)
    source_earliest_us: int = Field(ge=0)
    source_latest_us: int = Field(ge=0)
    uncertainty_us: int = Field(ge=0)
    status: Literal["healthy", "uncertain", "jump", "rollback", "restart", "disputed"]
    observed_at: datetime
    expires_at: datetime
    observation_hash: str

    @model_validator(mode="after")
    def valid(self):
        if self.earliest_us > self.latest_us or self.source_earliest_us > self.source_latest_us or self.expires_at <= self.observed_at: raise ValueError("invalid observation interval")
        if not (self.source_earliest_us <= self.earliest_us <= self.latest_us <= self.source_latest_us):
            raise ValueError("observation lies outside source interval")
        if self.uncertainty_us != self.latest_us - self.earliest_us: raise ValueError("uncertainty does not bound observed interval")
        if not HASH.fullmatch(self.observation_hash) or self.observation_hash != digest(self.model_dump(exclude={"observation_hash"})): raise ValueError("observation hash mismatch")
        return self


class ValidityInterval(TemporalModel):
    domain_id: str
    subject_hash: str
    valid_from_us: int = Field(ge=0)
    valid_until_us: int = Field(ge=1)
    interval_hash: str

    @model_validator(mode="after")
    def valid(self):
        if self.valid_from_us >= self.valid_until_us: raise ValueError("validity interval must be half-open and nonempty")
        if not HASH.fullmatch(self.subject_hash) or self.interval_hash != digest(self.model_dump(exclude={"interval_hash"})): raise ValueError("interval hash mismatch")
        return self


class SequencePoint(TemporalModel):
    kind: Literal["process", "workflow", "chain", "venue"]
    epoch: int = Field(ge=0)
    counter: int = Field(ge=0)
    event_hash: str

    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.event_hash):
            raise ValueError("sequence event hash is invalid")
        return self


class CausalLink(TemporalModel):
    predecessor_hash: str
    successor_hash: str
    proof_kind: Literal["explicit_parent", "workflow_history", "block_ancestor", "native_sequence", "same_operation"]
    source_evidence_hash: str
    link_hash: str

    @model_validator(mode="after")
    def valid(self):
        hashes = (self.predecessor_hash, self.successor_hash, self.source_evidence_hash, self.link_hash)
        if any(not HASH.fullmatch(item) for item in hashes): raise ValueError("causal link hash is invalid")
        if self.predecessor_hash == self.successor_hash or self.link_hash != digest(self.model_dump(exclude={"link_hash"})): raise ValueError("causal link mismatch")
        return self


class NonceLease(TemporalModel):
    domain_id: str
    signer_fingerprint: str = Field(pattern=r"^[a-f0-9]{16,64}$")
    acted_for_account: str = Field(pattern=r"^account:[a-z0-9_-]+$")
    nonce: int = Field(ge=0)
    operation: Literal["prepare", "sign", "submit", "close", "cancel", "revoke", "reconcile"]
    request_hash: str
    idempotency_key: str = Field(min_length=8, max_length=96)
    state: Literal["reserved", "signed", "possibly_submitted", "confirmed", "rejected_unused", "superseded"] = "reserved"
    lease_hash: str

    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.request_hash) or not HASH.fullmatch(self.lease_hash): raise ValueError("nonce lease hash is invalid")
        if self.lease_hash != digest(self.model_dump(exclude={"lease_hash"})): raise ValueError("nonce lease hash mismatch")
        return self


class TemporalInputManifest(TemporalModel):
    """Frozen complete local input body for one deterministic temporal decision."""
    operation: str = Field(pattern=r"^[a-z][a-z0-9_:-]{2,79}$")
    scope: TemporalScope
    spec: ClockDomainSpec
    observation: TimeHealthObservation
    interval: ValidityInterval
    sequence: SequencePoint | None = None
    causal: CausalLink | None = None
    nonce: NonceLease | None = None
    registry_hash: str
    inventory_hash: str
    scenario_hash: str
    idempotency_key: str = Field(min_length=8, max_length=96)
    request_hash: str
    manifest_hash: str

    @model_validator(mode="after")
    def valid(self):
        hashes = (self.registry_hash, self.inventory_hash, self.scenario_hash,
                  self.request_hash, self.manifest_hash)
        if any(not HASH.fullmatch(item) for item in hashes): raise ValueError("temporal input manifest hash is invalid")
        request = {"operation": self.operation, "scope": self.scope,
                   "scenarioHash": self.scenario_hash, "idempotencyKey": self.idempotency_key}
        if self.operation not in self.spec.allowed_operations:
            raise ValueError("manifest operation is not allowed by its clock domain")
        if self.observation.domain_id != self.spec.domain_id or self.interval.domain_id != self.spec.domain_id:
            raise ValueError("manifest domain bindings are inconsistent")
        if self.observation.scope != self.scope or self.observation.spec_hash != self.spec.spec_hash:
            raise ValueError("manifest observation binding is inconsistent")
        if self.request_hash != digest(request): raise ValueError("temporal request hash mismatch")
        if self.manifest_hash != digest(self.model_dump(exclude={"manifest_hash"})):
            raise ValueError("temporal input manifest hash mismatch")
        return self


class TemporalSafetyDecision(TemporalModel):
    operation: str
    scope: TemporalScope
    outcome: Literal["allow", "block", "unknown", "safe_only"]
    reasons: list[str] = Field(max_length=12)
    observation_hash: str
    interval_hash: str
    sequence_hash: str | None = None
    causal_hash: str | None = None
    nonce_lease_hash: str | None = None
    registry_hash: str
    inventory_hash: str
    input_manifest_hash: str
    request_hash: str
    expires_at: datetime
    idempotency_key: str
    decision_hash: str

    @model_validator(mode="after")
    def valid(self):
        hashes = (self.observation_hash, self.interval_hash, self.registry_hash,
                  self.inventory_hash, self.input_manifest_hash, self.request_hash,
                  self.decision_hash)
        if any(not HASH.fullmatch(item) for item in hashes): raise ValueError("decision hash is invalid")
        if any(item is not None and not HASH.fullmatch(item) for item in (self.sequence_hash, self.causal_hash, self.nonce_lease_hash)):
            raise ValueError("decision input hash is invalid")
        if self.reasons != sorted(set(self.reasons)) or self.decision_hash != digest(self.model_dump(exclude={"decision_hash"})): raise ValueError("decision hash or reason set mismatch")
        return self
