"""Closed inventory contracts; observations are fixture evidence, never native calls."""
from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from pydantic import Field, model_validator
from .strategy_termination_canonical import HASH, ID, digest, normal
from .strategy_termination_scope_contracts import Model


class OwnerManifest(Model):
    scope_hash: str; owners: list[str]; categories: list[str]; manifest_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.owners != sorted(set(self.owners)) or self.categories != sorted(set(self.categories)) or not all(ID.fullmatch(x) for x in self.owners + self.categories): raise ValueError("manifest set invalid")
        if not HASH.fullmatch(self.scope_hash) or self.manifest_hash != digest(self.model_dump(exclude={"manifest_hash"})): raise ValueError("manifest hash invalid")
        return self


class OwnerObservation(Model):
    scope_hash: str; owner: str = Field(pattern=ID); category: str = Field(pattern=ID); subject_hash: str
    native_state: Literal["terminal", "pending", "residual", "owner_checkpoint", "unknown"]
    coordinate_hash: str; predecessor_hash: str | None = None; evidence_hash: str; source_hash: str
    effective_at: datetime; observed_at: datetime; expires_at: datetime; observation_hash: str
    @model_validator(mode="after")
    def valid(self):
        hashes = [self.scope_hash, self.subject_hash, self.coordinate_hash, self.evidence_hash, self.source_hash] + ([self.predecessor_hash] if self.predecessor_hash else [])
        if not all(HASH.fullmatch(x) for x in hashes) or not self.effective_at <= self.observed_at < self.expires_at: raise ValueError("observation bounds invalid")
        if self.observation_hash != digest(self.model_dump(exclude={"observation_hash"})): raise ValueError("observation hash invalid")
        return self


class TerminationInventoryItem(Model):
    observation_hash: str; owner: str = Field(pattern=ID); category: str = Field(pattern=ID); subject_hash: str
    state: Literal["terminal_verified", "pending_safe_step", "residual_known", "owner_checkpoint", "unknown"]
    disposition: str | None = Field(default=None, pattern=ID); reason_code: str | None = Field(default=None, pattern=ID)
    next_step_kind: str | None = Field(default=None, pattern=ID); item_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.observation_hash, self.subject_hash)) or self.item_hash != digest(self.model_dump(exclude={"item_hash"})): raise ValueError("inventory item invalid")
        if self.state == "terminal_verified" and not self.disposition: raise ValueError("terminal item needs disposition")
        if self.state != "terminal_verified" and not (self.reason_code or self.next_step_kind): raise ValueError("nonterminal item needs next state")
        return self


class TerminationInventorySnapshot(Model):
    scope_hash: str; latch_hash: str; manifest_hash: str; dependency_hashes: list[str]; item_hashes: list[str]
    frozen_at: datetime; snapshot_revision: int = Field(ge=1); snapshot_hash: str
    @model_validator(mode="after")
    def valid(self):
        for values in (self.dependency_hashes, self.item_hashes):
            if values != sorted(set(values)) or not all(HASH.fullmatch(x) for x in values): raise ValueError("inventory closure invalid")
        if not all(HASH.fullmatch(x) for x in (self.scope_hash, self.latch_hash, self.manifest_hash)) or self.snapshot_hash != digest(self.model_dump(exclude={"snapshot_hash"})): raise ValueError("snapshot invalid")
        return self
