"""Strict, local-only contracts for execution artifact certification.

Only sanitized fixture identities are accepted here.  The canonical algorithm is
shared by every persisted record: sorted UTF-8 JSON, no floats, and UTC ``Z``.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from .contracts import StrictModel

Hash = str
ScopeKind = Literal["shared", "tenant", "account"]
Outcome = Literal["pass", "block", "close_only", "unknown"]
ArtifactType = Literal["runtime", "direct", "uups", "transparent", "beacon", "beacon_implementation", "abi", "eip712", "hook", "pool", "registry", "adapter", "sdk", "image", "build", "git", "token", "target", "config"]
HASH = re.compile(r"^[a-f0-9]{64}$")


def _normalise(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
            raise ValueError("Artifact timestamps must be UTC")
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, BaseModel):
        return _normalise(value.model_dump(mode="python", exclude_none=False))
    if isinstance(value, dict):
        if any(type(key) is not str for key in value): raise ValueError("Artifact hash keys must be strings")
        return {key: _normalise(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)): return [_normalise(item) for item in value]
    if isinstance(value, float): raise ValueError("Artifact contracts prohibit floating-point values")
    return value


def canonical_json(value: Any) -> bytes:
    return json.dumps(_normalise(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(value: Any) -> Hash:
    return sha256(canonical_json(value)).hexdigest()


class ArtifactModel(StrictModel):
    @model_validator(mode="before")
    @classmethod
    def strict_values(cls, value: Any):
        _normalise(value)
        return value


class ArtifactScope(ArtifactModel):
    kind: ScopeKind
    key: str = Field(min_length=6, max_length=120)

    @model_validator(mode="after")
    def canonical_key(self):
        expected = "shared" if self.kind == "shared" else f"{self.kind}:"
        if (self.kind == "shared" and self.key != "shared") or (self.kind != "shared" and not re.fullmatch(rf"{expected}[a-z0-9_-]+", self.key)):
            raise ValueError("Artifact scope key is not canonical")
        return self


class ArtifactEdge(ArtifactModel):
    parent_id: str = Field(pattern=r"^[a-z][a-z0-9_-]{2,79}$")
    child_id: str = Field(pattern=r"^[a-z][a-z0-9_-]{2,79}$")

    @model_validator(mode="after")
    def no_self_edge(self):
        if self.parent_id == self.child_id: raise ValueError("Artifact graph self-edge is forbidden")
        return self


class ExecutableArtifactSpec(ArtifactModel):
    schema_version: Literal[1] = 1
    artifact_id: str = Field(pattern=r"^[a-z][a-z0-9_-]{2,79}$")
    version: int = Field(ge=1)
    artifact_type: ArtifactType
    scope: ArtifactScope
    domain: Literal["chain:42161", "build"] = "build"
    locator: str = Field(default="fixture", min_length=3, max_length=160)
    topology: Literal["direct", "uups", "transparent", "beacon", "nonstandard", "none"] = "none"
    operations: list[str] = Field(min_length=1, max_length=32)
    dependencies: list[str] = Field(default_factory=list, max_length=64)
    identity: dict[str, str] = Field(min_length=1, max_length=32)
    review_evidence_hashes: list[Hash] = Field(default_factory=list, max_length=16)
    effective_at: datetime
    expires_at: datetime
    revoked_at: datetime | None = None
    freshness_seconds: int = Field(ge=1, le=86400)
    finality: Literal["safe", "finalized", "none"] = "none"
    spec_hash: Hash

    @model_validator(mode="after")
    def valid_spec(self):
        if self.expires_at <= self.effective_at or (self.revoked_at and self.revoked_at < self.effective_at): raise ValueError("Artifact spec validity window is invalid")
        for values, label in ((self.operations, "operations"), (self.dependencies, "dependencies"), (self.review_evidence_hashes, "review evidence")):
            if values != sorted(set(values)): raise ValueError(f"Artifact {label} must be unique and sorted")
        if any(not HASH.fullmatch(value) for value in self.identity.values()): raise ValueError("Artifact identities must be hashes")
        if any(not HASH.fullmatch(value) for value in self.review_evidence_hashes): raise ValueError("Review evidence must be hashes")
        if self.spec_hash != digest(spec_body(self)): raise ValueError("Artifact spec hash mismatch")
        return self


class ArtifactObservation(ArtifactModel):
    artifact_id: str
    version: int = Field(ge=1)
    scope: ArtifactScope
    source: Literal["local_fixture"] = "local_fixture"
    boundary: Literal["prepare", "sign", "dispatch", "close", "reconcile"]
    identity: dict[str, str] = Field(min_length=1, max_length=32)
    fixture_manifest_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    observed_at: datetime
    expires_at: datetime
    finality: Literal["pending", "safe", "finalized", "unknown", "reorged"] = "finalized"
    block_number: int | None = Field(default=None, ge=0)
    block_hash: str | None = None
    parent_hash: str | None = None
    observation_hash: Hash

    @model_validator(mode="after")
    def valid_observation(self):
        if self.expires_at <= self.observed_at: raise ValueError("Observation expiry must follow observation time")
        if self.finality in {"safe", "finalized", "pending", "reorged"} and (self.block_number is None or not self.block_hash): raise ValueError("Chain observation requires a block lineage")
        if self.observation_hash != digest(observation_body(self)): raise ValueError("Artifact observation hash mismatch")
        return self


class CertificationDecision(ArtifactModel):
    operation: str
    account_scope: ArtifactScope
    venue_ref: str = "fixture"
    route_ref: str = "fixture"
    grant_ref: str = "fixture"
    equivalence_ref: str = "fixture"
    outcome: Outcome
    reasons: list[str]
    permitted_lanes: list[Literal["close", "reconcile"]]
    graph_hash: Hash
    spec_manifest_hash: Hash
    observation_manifest_hash: Hash
    input_manifest_hash: Hash
    request_hash: Hash
    evaluated_at: datetime
    expires_at: datetime
    idempotency_key: str = Field(min_length=8, max_length=96)
    decision_hash: Hash

    @model_validator(mode="after")
    def valid_decision(self):
        hashes = (self.graph_hash, self.spec_manifest_hash, self.observation_manifest_hash,
                  self.input_manifest_hash, self.request_hash, self.decision_hash)
        if any(not HASH.fullmatch(value) for value in hashes):
            raise ValueError("Certification decision contains an invalid hash")
        if self.expires_at <= self.evaluated_at:
            raise ValueError("Certification decision expiry is invalid")
        if self.reasons != sorted(set(self.reasons)) or self.permitted_lanes != sorted(set(self.permitted_lanes)):
            raise ValueError("Certification decision lists must be unique and sorted")
        if self.outcome == "pass" and (self.permitted_lanes or self.reasons != ["certified"]):
            raise ValueError("Passing certification cannot carry safety lanes or reasons")
        if self.outcome != "close_only" and self.permitted_lanes:
            raise ValueError("Only close-only certification may carry safety lanes")
        if self.decision_hash != digest(self.model_dump(exclude={"decision_hash"})):
            raise ValueError("Certification decision hash mismatch")
        return self


class CertificationInputManifest(ArtifactModel):
    """The complete, fixture-only input identity behind one certification decision."""

    operation: str = Field(pattern=r"^[a-z][a-z0-9_:-]{2,79}$")
    account_scope: ArtifactScope
    boundary: Literal["prepare", "sign", "dispatch", "close", "reconcile"]
    registry_hash: Hash
    spec_hashes: list[Hash]
    observation_hashes: list[Hash]
    idempotency_key: str = Field(min_length=8, max_length=96)
    request_hash: Hash
    manifest_hash: Hash

    @model_validator(mode="after")
    def valid_manifest(self):
        if any(not HASH.fullmatch(item) for item in (
            self.registry_hash, self.request_hash, self.manifest_hash,
            *self.spec_hashes, *self.observation_hashes,
        )):
            raise ValueError("Certification manifest contains an invalid hash")
        if self.spec_hashes != sorted(set(self.spec_hashes)):
            raise ValueError("Certification manifest specs must be unique and sorted")
        if self.observation_hashes != sorted(set(self.observation_hashes)):
            raise ValueError("Certification manifest observations must be unique and sorted")
        request = {"operation": self.operation, "scope": self.account_scope,
                   "boundary": self.boundary, "idempotencyKey": self.idempotency_key}
        if self.request_hash != digest(request):
            raise ValueError("Certification request hash mismatch")
        if self.manifest_hash != digest(self.model_dump(exclude={"manifest_hash"})):
            raise ValueError("Certification input manifest hash mismatch")
        return self


class DriftEvent(ArtifactModel):
    artifact_id: str
    scope: ArtifactScope
    drift_class: str
    prior_observation_hash: Hash | None = None
    current_observation_hash: Hash
    affected_dependants: list[str]
    first_detected_at: datetime
    last_detected_at: datetime
    latch_state: Literal["latched"] = "latched"
    invalidation_set_hash: Hash
    drift_hash: Hash

    @model_validator(mode="after")
    def valid_drift(self):
        if self.affected_dependants != sorted(set(self.affected_dependants)):
            raise ValueError("Drift dependants must be unique and sorted")
        if self.last_detected_at < self.first_detected_at:
            raise ValueError("Drift timestamps are invalid")
        hashes = [self.current_observation_hash, self.invalidation_set_hash, self.drift_hash]
        if self.prior_observation_hash: hashes.append(self.prior_observation_hash)
        if any(not HASH.fullmatch(value) for value in hashes):
            raise ValueError("Drift contains an invalid hash")
        if self.invalidation_set_hash != digest(self.affected_dependants):
            raise ValueError("Drift invalidation set hash mismatch")
        if self.drift_hash != digest(self.model_dump(exclude={"drift_hash"})):
            raise ValueError("Drift hash mismatch")
        return self


class RequalificationDecision(ArtifactModel):
    scope: ArtifactScope
    drift_hash: Hash
    proposed_spec_hash: Hash
    observation_manifest_hash: Hash
    review_evidence_hashes: list[Hash]
    reviewer_ids: list[str]
    outcome: Literal["approve", "reject"]
    predecessor_hash: Hash | None = None
    idempotency_key: str
    decision_hash: Hash

    @model_validator(mode="after")
    def valid_requalification(self):
        if self.reviewer_ids != sorted(set(self.reviewer_ids)) or len(self.reviewer_ids) < 2: raise ValueError("Requalification needs distinct sorted reviewer fixture IDs")
        hashes = [self.drift_hash, self.proposed_spec_hash, self.observation_manifest_hash,
                  self.decision_hash, *self.review_evidence_hashes]
        if self.predecessor_hash: hashes.append(self.predecessor_hash)
        if any(not HASH.fullmatch(value) for value in hashes): raise ValueError("Requalification contains an invalid hash")
        if self.review_evidence_hashes != sorted(set(self.review_evidence_hashes)):
            raise ValueError("Requalification evidence must be unique and sorted")
        if self.decision_hash != digest(self.model_dump(exclude={"decision_hash"})):
            raise ValueError("Requalification decision hash mismatch")
        return self


def spec_body(spec: ExecutableArtifactSpec) -> dict[str, Any]:
    body = spec.model_dump(mode="python", exclude={"spec_hash"})
    # Version-one fixtures predate descriptive fields.  Their signed body remains
    # stable while newly authored records include those fields normally.
    for field in ("domain", "locator", "topology", "review_evidence_hashes", "finality"):
        if field not in spec.model_fields_set: body.pop(field, None)
    return body
def observation_body(observation: ArtifactObservation) -> dict[str, Any]: return observation.model_dump(mode="python", exclude={"observation_hash"})
