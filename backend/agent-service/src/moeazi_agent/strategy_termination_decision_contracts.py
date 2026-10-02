"""Decision, residual and completion contracts for local fixture proof."""
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import Field, model_validator
from .strategy_termination_canonical import HASH, ID, digest
from .strategy_termination_scope_contracts import Model


class OwnerCheckpoint(Model):
    scope_hash: str; subject_hash: str; action: str = Field(pattern=ID); reason_code: str = Field(pattern=ID)
    cost_state: Literal["known_fixture_zero", "unknown"]; decision: Literal["pending", "approved_fixture", "declined_fixture"]
    expires_at: datetime; checkpoint_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.scope_hash, self.subject_hash)) or self.checkpoint_hash != digest(self.model_dump(exclude={"checkpoint_hash"})): raise ValueError("checkpoint invalid")
        return self


class ResidualObligation(Model):
    item_hash: str; owner: str = Field(pattern=ID); category: str = Field(pattern=ID); state: Literal["residual", "unknown", "owner_checkpoint"]
    reason_code: str = Field(pattern=ID); recovery_instruction: Literal["read_only_reconcile", "owner_decision", "preserve_hold"]
    blocks_completion: bool = True; residual_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.item_hash) or self.residual_hash != digest(self.model_dump(exclude={"residual_hash"})): raise ValueError("residual invalid")
        return self


class TerminationStatusDecision(Model):
    scope_hash: str; latch_hash: str; snapshot_hash: str; plan_hash: str
    state: Literal["termination_unverified", "automation_stopped_verified", "stopped_with_residuals", "blocked_needs_owner", "fully_terminated_verified"]
    automation_stop_verified: bool; terminal_count: int = Field(ge=0); pending_count: int = Field(ge=0)
    residual_count: int = Field(ge=0); unknown_count: int = Field(ge=0); owner_checkpoint_count: int = Field(ge=0)
    reason_codes: list[str]; decision_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.reason_codes != sorted(set(self.reason_codes)) or not all(ID.fullmatch(x) for x in self.reason_codes): raise ValueError("decision reasons invalid")
        if self.state == "fully_terminated_verified" and any((self.pending_count, self.residual_count, self.unknown_count, self.owner_checkpoint_count)): raise ValueError("completion has obligations")
        if self.state == "termination_unverified" and self.automation_stop_verified: raise ValueError("unverified cannot claim stop")
        if not all(HASH.fullmatch(x) for x in (self.scope_hash, self.latch_hash, self.snapshot_hash, self.plan_hash)) or self.decision_hash != digest(self.model_dump(exclude={"decision_hash"})): raise ValueError("decision invalid")
        return self


class TerminationCompletionReceipt(Model):
    decision_hash: str; latch_hash: str; snapshot_hash: str; plan_hash: str; receipt_hashes: list[str]
    product_availability: Literal["unavailable"]; completion_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.receipt_hashes != sorted(set(self.receipt_hashes)) or not all(HASH.fullmatch(x) for x in self.receipt_hashes + [self.decision_hash, self.latch_hash, self.snapshot_hash, self.plan_hash]): raise ValueError("completion closure invalid")
        if self.completion_hash != digest(self.model_dump(exclude={"completion_hash"})): raise ValueError("completion hash invalid")
        return self
