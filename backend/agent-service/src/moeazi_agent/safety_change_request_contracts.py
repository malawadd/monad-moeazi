"""Typed request and diff contracts for checked-in safety-change fixtures."""
from __future__ import annotations
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from pydantic import ConfigDict, Field, model_validator
from .contracts import StrictModel
from .safety_change_quorum_canonical import HASH, ID, digest, normal
from .safety_change_scope_contracts import SafetyScope

class DiffEntry(StrictModel):
    model_config=ConfigDict(extra="forbid", frozen=True, strict=True)
    path: str = Field(pattern=r"^[a-z][a-z0-9_.]{2,100}$"); before: Any; after: Any

class SafetyChangeClass(StrEnum):
    restrictive = "restrictive"; relaxing = "relaxing"; unknown_or_blocked = "unknown_or_blocked"

class FrozenInputManifest(StrictModel):
    model_config=ConfigDict(extra="forbid", frozen=True, strict=True)
    request_hash: str; registry_hash: str; repository_sha: str = Field(pattern=r"^[a-f0-9]{40}$"); manifest_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(v) for v in (self.request_hash,self.registry_hash,self.manifest_hash)) or self.manifest_hash != digest(self.model_dump(exclude={"manifest_hash"})): raise ValueError("manifest invalid")
        return self

class RollbackTarget(StrictModel):
    model_config=ConfigDict(extra="forbid", frozen=True, strict=True)
    exact_before_state_hash: str; rollback_class: Literal["restrictive","relaxing"]; target_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(v) for v in (self.exact_before_state_hash,self.target_hash)) or self.target_hash != digest(self.model_dump(exclude={"target_hash"})): raise ValueError("rollback target invalid")
        return self

class ChangeRequest(StrictModel):
    model_config=ConfigDict(extra="forbid", frozen=True, strict=True)
    scope: SafetyScope; requester_person: str = Field(pattern=ID); requester_account: str = Field(pattern=ID)
    diffs: list[DiffEntry] = Field(min_length=1, max_length=12); policy_hash: str; registry_hash: str
    repository_sha: str = Field(pattern=r"^[a-f0-9]{40}$"); before_state_hash: str; after_state_hash: str
    evidence_hashes: list[str]; test_hashes: list[str]; expires_at: datetime; idempotency_key: str = Field(pattern=ID)
    request_hash: str
    @model_validator(mode="before")
    @classmethod
    def canonical(cls, value): normal(value); return value
    @model_validator(mode="after")
    def valid(self):
        if self.evidence_hashes != sorted(set(self.evidence_hashes)) or self.test_hashes != sorted(set(self.test_hashes)):
            raise ValueError("hash sets must be sorted unique")
        if not all(HASH.fullmatch(v) for v in [self.policy_hash,self.registry_hash,self.before_state_hash,self.after_state_hash,*self.evidence_hashes,*self.test_hashes]): raise ValueError("hash format invalid")
        if self.request_hash != digest(self.model_dump(exclude={"request_hash"})): raise ValueError("request hash invalid")
        return self
