"""Owner-produced immutable gate inputs for the local fixture reducer."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import Field, model_validator

from .effective_authority_canonical import digest
from .effective_authority_scope_contracts import AuthorityScope, BoundaryIdentity, Frozen, Hash


class SourceReceiptReference(Frozen):
    source_type: str = Field(pattern=r"^[a-z][a-z0-9_-]{2,63}$")
    source_version: str = Field(pattern=r"^fixture-v[0-9]+$")
    receipt_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    revision: int = Field(ge=1)
    provenance: Literal["local_fixture_untrusted", "authoritative_product"] = "local_fixture_untrusted"


class GateResult(Frozen):
    gate_id: str = Field(pattern=r"^[a-z][a-z0-9_]{2,63}$")
    registry_version: Literal["effective-authority-v1"] = "effective-authority-v1"
    scope: AuthorityScope
    boundary: BoundaryIdentity
    status: Literal["pass", "fail", "unknown", "stale", "not_applicable"]
    ceiling: Literal["ANALYZE_ONLY", "SHADOW_SIMULATE", "PREFLIGHT_ONLY", "SUBMISSION_ELIGIBLE"]
    reason_code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{2,63}$")
    remediation_code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{2,63}$")
    observed_at: datetime
    expires_at: datetime
    source: SourceReceiptReference
    sequence: int = Field(ge=1)
    predecessor_hash: Hash | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    result_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def _valid(self):
        if any(value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value) or value.microsecond % 1000 for value in (self.observed_at, self.expires_at)):
            raise ValueError("invalid_gate_time")
        if self.expires_at <= self.observed_at:
            raise ValueError("invalid_gate_time")
        if self.result_hash != digest(self.model_dump(exclude={"result_hash"})):
            raise ValueError("gate_hash_mismatch")
        return self


class GateInputManifest(Frozen):
    request_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    registry_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    gate_hashes: tuple[Hash, ...]
    manifest_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def _shape(self):
        if tuple(sorted(set(self.gate_hashes))) != self.gate_hashes:
            raise ValueError("manifest_closure_invalid")
        if self.manifest_hash != digest(self.model_dump(exclude={"manifest_hash"})):
            raise ValueError("manifest_closure_invalid")
        return self
