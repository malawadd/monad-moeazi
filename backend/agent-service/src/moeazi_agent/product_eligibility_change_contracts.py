"""Typed, non-authorizing rulepack change and fixture activation receipts."""
from __future__ import annotations
from datetime import datetime, timedelta
from typing import Literal
from pydantic import Field, model_validator
from .product_eligibility_canonical import digest
from .product_eligibility_scope_contracts import Frozen, ProductEligibilityScope


class SafetyChangeQuorumBinding(Frozen):
    scope_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    quorum_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    status: Literal["requires_revalidation"]
    synthetic_untrusted: Literal[True] = True
    binding_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    @model_validator(mode="after")
    def check(self):
        if self.binding_hash != digest(self.model_dump(exclude={"binding_hash"}, mode="python")): raise ValueError("quorum_binding_invalid")
        return self


class RulepackChange(Frozen):
    scope: ProductEligibilityScope
    before_rulepack_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    after_rulepack_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    direction: Literal["tightening", "loosening", "mixed", "neutral", "deactivate", "rollback"]
    declared_at: datetime
    change_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    @model_validator(mode="after")
    def check(self):
        if self.before_rulepack_hash == self.after_rulepack_hash or self.change_hash != digest(self.model_dump(exclude={"change_hash"}, mode="python")): raise ValueError("rulepack_change_invalid")
        return self


class RulepackActivationReceipt(Frozen):
    scope_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    sequence: int = Field(ge=1)
    predecessor_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    change_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    status: Literal["fixture_activated", "fixture_contained", "fixture_deactivated", "fixture_rolled_back"]
    activated_at: datetime
    expires_at: datetime
    quorum_binding_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    receipt_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    @model_validator(mode="after")
    def check(self):
        if self.expires_at <= self.activated_at or (self.sequence == 1) != (self.predecessor_hash is None): raise ValueError("activation_chain_invalid")
        if self.receipt_hash != digest(self.model_dump(exclude={"receipt_hash"}, mode="python")): raise ValueError("activation_receipt_invalid")
        return self


def activation_allowed(change: RulepackChange, quorum: SafetyChangeQuorumBinding | None,
                       now: datetime, requested_expiry: datetime) -> bool:
    """Only local fixture activation; loosening/mixed requires exact revalidation binding."""
    if requested_expiry <= now or requested_expiry > now + timedelta(seconds=900): return False
    if change.direction in {"loosening", "mixed"}:
        return bool(quorum and quorum.scope_hash == change.scope.scope_hash and quorum.status == "requires_revalidation")
    return change.direction in {"tightening", "neutral", "deactivate", "rollback"}
