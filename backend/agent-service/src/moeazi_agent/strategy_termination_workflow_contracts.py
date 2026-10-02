"""Pure plan and immutable fixture-receipt contracts for termination."""
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import Field, model_validator
from .strategy_termination_canonical import HASH, ID, digest
from .strategy_termination_scope_contracts import Model


class TerminationStep(Model):
    scope_hash: str; strategy_fingerprint: str = Field(pattern=ID); termination_revision: int = Field(ge=1)
    step_kind: str = Field(pattern=ID); subject_hash: str; dependencies: list[str]; action_class: Literal["verify", "safe_fixture", "owner_checkpoint", "classify"]
    step_id: str; step_hash: str
    @model_validator(mode="after")
    def valid(self):
        expected = f"{self.strategy_fingerprint}:{self.termination_revision}:{self.step_kind}:{self.subject_hash}"
        if self.step_id != expected or self.dependencies != sorted(set(self.dependencies)) or not all(HASH.fullmatch(x) for x in self.dependencies + [self.scope_hash, self.subject_hash]): raise ValueError("step identity invalid")
        if self.step_hash != digest(self.model_dump(exclude={"step_hash"})): raise ValueError("step hash invalid")
        return self


class TerminationPlan(Model):
    scope_hash: str; latch_hash: str; snapshot_hash: str; ordered_step_hashes: list[str]; plan_hash: str
    @model_validator(mode="after")
    def valid(self):
        if len(set(self.ordered_step_hashes)) != len(self.ordered_step_hashes) or not all(HASH.fullmatch(x) for x in self.ordered_step_hashes + [self.scope_hash, self.latch_hash, self.snapshot_hash]): raise ValueError("plan closure invalid")
        if self.plan_hash != digest(self.model_dump(exclude={"plan_hash"})): raise ValueError("plan hash invalid")
        return self


class TerminationStepAttempt(Model):
    step_hash: str; attempt: int = Field(ge=1); predecessor_receipt_hash: str | None = None; idempotency_key: str = Field(pattern=r"^[A-Za-z0-9._:-]{8,120}$")
    input_hash: str; observed_at: datetime; attempt_hash: str
    @model_validator(mode="after")
    def valid(self):
        fields = [self.step_hash, self.input_hash] + ([self.predecessor_receipt_hash] if self.predecessor_receipt_hash else [])
        if not all(HASH.fullmatch(x) for x in fields) or self.attempt_hash != digest(self.model_dump(exclude={"attempt_hash"})): raise ValueError("attempt invalid")
        return self


class TerminationStepReceipt(Model):
    attempt_hash: str; step_hash: str; pre_state_hash: str; post_state_hash: str
    outcome: Literal["verified_terminal", "pending", "residual", "unknown", "conflict"]
    side_effect_count: Literal[0]; observed_at: datetime; receipt_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.attempt_hash, self.step_hash, self.pre_state_hash, self.post_state_hash)) or self.receipt_hash != digest(self.model_dump(exclude={"receipt_hash"})): raise ValueError("receipt invalid")
        return self

class TerminationAttemptTransition(Model):
    scope_hash: str; predecessor_hash: str | None = None; state: Literal["latched", "inventory_ready", "decommissioning", "awaiting_owner", "decided", "conflict"]
    event_hash: str
    @model_validator(mode="after")
    def valid(self):
        values=[self.scope_hash]+([self.predecessor_hash] if self.predecessor_hash else [])
        if not all(HASH.fullmatch(x) for x in values) or self.event_hash != digest(self.model_dump(exclude={"event_hash"})): raise ValueError("transition invalid")
        return self

class TerminationConflictReceipt(Model):
    scope_hash: str; request_hash: str; reason_code: str = Field(pattern=ID); conflict_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.scope_hash,self.request_hash)) or self.conflict_hash != digest(self.model_dump(exclude={"conflict_hash"})): raise ValueError("conflict invalid")
        return self
