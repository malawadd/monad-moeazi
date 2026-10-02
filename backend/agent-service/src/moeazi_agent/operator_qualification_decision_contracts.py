"""Non-authoritative local decision, grant, revocation and consumption receipts."""
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import ConfigDict, Field, model_validator
from .contracts import StrictModel
from .operator_qualification_canonical import HASH, ID, digest, normal

class _DecisionModel(StrictModel):
    model_config=ConfigDict(extra="forbid", frozen=True, strict=True)
    @model_validator(mode="before")
    @classmethod
    def canonical(cls, value): normal(value); return value

class OperatorQualificationDecision(_DecisionModel):
    scope_hash: str; principal_hash: str; role_hash: str; manifest_hash: str; outcome: Literal["granted_fixture", "blocked", "incomplete"]
    reason_codes: list[str]; decision_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.reason_codes != sorted(set(self.reason_codes)) or not all(HASH.fullmatch(x) for x in (self.scope_hash,self.principal_hash,self.role_hash,self.manifest_hash,self.decision_hash)) or self.decision_hash != digest(self.model_dump(exclude={"decision_hash"})): raise ValueError("decision invalid")
        return self

class OperatorQualificationGrant(_DecisionModel):
    scope_hash: str; principal_hash: str; role_hash: str; decision_hash: str; calibration_hash: str
    issued_at: datetime; expires_at: datetime; state: Literal["active_fixture"]; grant_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.expires_at <= self.issued_at or not all(HASH.fullmatch(x) for x in (self.scope_hash,self.principal_hash,self.role_hash,self.decision_hash,self.calibration_hash,self.grant_hash)) or self.grant_hash != digest(self.model_dump(exclude={"grant_hash"})): raise ValueError("grant invalid")
        return self

class QualificationRevocation(_DecisionModel):
    scope_hash: str; grant_hash: str; reason_code: str = Field(pattern=ID); revoked_at: datetime; revocation_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.scope_hash,self.grant_hash,self.revocation_hash)) or self.revocation_hash != digest(self.model_dump(exclude={"revocation_hash"})): raise ValueError("revocation invalid")
        return self

class QualificationConsumptionReceipt(_DecisionModel):
    scope_hash: str; grant_hash: str | None = None; consumer_feature: str = Field(pattern=ID); operation: str = Field(pattern=ID)
    effective_state: Literal["active_fixture", "expired", "revoked", "drifted", "disputed", "unknown"]
    fixture_compatible: bool; accepted_for_product: Literal[False] = False; reason_codes: list[str]; receipt_hash: str
    @model_validator(mode="after")
    def valid(self):
        hashes=[self.scope_hash,self.receipt_hash]+([self.grant_hash] if self.grant_hash else [])
        if self.reason_codes != sorted(set(self.reason_codes)) or self.accepted_for_product or not all(HASH.fullmatch(x) for x in hashes) or self.receipt_hash != digest(self.model_dump(exclude={"receipt_hash"})): raise ValueError("consumption invalid")
        return self

class QualificationTransition(_DecisionModel):
    scope_hash: str; predecessor_hash: str | None = None; state: str = Field(pattern=ID); transition_hash: str
    @model_validator(mode="after")
    def valid(self):
        hashes=[self.scope_hash,self.transition_hash]+([self.predecessor_hash] if self.predecessor_hash else [])
        if not all(HASH.fullmatch(x) for x in hashes) or self.transition_hash != digest(self.model_dump(exclude={"transition_hash"})): raise ValueError("transition invalid")
        return self

class QualificationConflict(_DecisionModel):
    scope_hash: str; idempotency_key: str = Field(pattern=ID); request_hash: str; conflict_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.scope_hash,self.request_hash,self.conflict_hash)) or self.conflict_hash != digest(self.model_dump(exclude={"conflict_hash"})): raise ValueError("conflict invalid")
        return self
