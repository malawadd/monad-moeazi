"""Strict scope, request, latch and direct-dependency contracts."""
from __future__ import annotations
from datetime import datetime
import re
from typing import Any, Literal
from pydantic import Field, model_validator
from .contracts import StrictModel
from .strategy_termination_canonical import HASH, ID, digest, normal


class Model(StrictModel):
    @model_validator(mode="before")
    @classmethod
    def canonical(cls, value: Any): normal(value); return value


class TerminationScope(Model):
    operator_test_id: str = Field(pattern=ID); tenant_fingerprint: str = Field(pattern=ID)
    account_fingerprint: str = Field(pattern=ID); strategy_fingerprint: str = Field(pattern=ID)
    owner_fixture: Literal["particle_fixture", "magic_fixture"]; chain_id: Literal[42161]
    termination_revision: int = Field(ge=1, le=1_000_000); scope_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.scope_hash != digest(self.model_dump(exclude={"scope_hash"})): raise ValueError("scope hash mismatch")
        return self


class StrategyTerminationRequest(Model):
    scope_hash: str; termination_revision: int = Field(ge=1); reason: Literal["operator_requested", "safety_stop", "fixture_replay"]
    requested_outcome: Literal["automation_stop", "full_termination"]; idempotency_key: str = Field(pattern=r"^[A-Za-z0-9._:-]{8,80}$")
    requested_at: datetime; request_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.scope_hash) or self.request_hash != digest(self.model_dump(exclude={"request_hash"})):
            raise ValueError("termination request binding invalid")
        return self


class TerminationLatch(Model):
    scope_hash: str; request_hash: str; termination_revision: int = Field(ge=1); predecessor_latch_hash: str | None = None
    epoch: int = Field(ge=1); committed_at: datetime; denied_operations: list[str]; recovery_safe_operations: list[str]; latch_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.denied_operations != sorted(set(self.denied_operations)) or self.recovery_safe_operations != sorted(set(self.recovery_safe_operations)):
            raise ValueError("latch operation sets must be sorted")
        if set(self.denied_operations) & set(self.recovery_safe_operations): raise ValueError("latch operations overlap")
        values = [self.scope_hash, self.request_hash, self.latch_hash] + ([self.predecessor_latch_hash] if self.predecessor_latch_hash else [])
        if not all(HASH.fullmatch(item) for item in values) or self.latch_hash != digest(self.model_dump(exclude={"latch_hash"})):
            raise ValueError("latch hash invalid")
        return self


class DirectDependencyBinding(Model):
    feature_id: Literal["cross-state-recovery-continuity", "intent-execution-equivalence"]
    operator_test_id: str = Field(pattern=ID); scope_relation: Literal["same_operator_fixture"]
    run_id: str = Field(pattern=r"^run-[a-f0-9]{32}$"); run_hash: str; bundle_hash: str; control_hash: str; registry_hash: str; release_hash: str
    expires_at: datetime; status: Literal["requires_revalidation"]; binding_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(item) for item in (self.run_hash, self.bundle_hash, self.control_hash, self.registry_hash)) or not re.fullmatch(r"[a-f0-9]{40}", self.release_hash):
            raise ValueError("dependency hashes invalid")
        if self.binding_hash != digest(self.model_dump(exclude={"binding_hash"})): raise ValueError("dependency binding hash invalid")
        return self


class ContextReleaseBinding(Model):
    feature_id: Literal["collateral-resilience-exit-capacity"]; release_hash: str; registry_hash: str
    attribution: Literal["untrusted_context_only"]; binding_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not re.fullmatch(r"[a-f0-9]{40}", self.release_hash) or not HASH.fullmatch(self.registry_hash) or self.binding_hash != digest(self.model_dump(exclude={"binding_hash"})):
            raise ValueError("context binding invalid")
        return self
