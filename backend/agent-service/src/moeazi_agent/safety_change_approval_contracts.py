"""Attestations intentionally distinguish person and account fixture identities."""
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import ConfigDict, Field, model_validator
from .contracts import StrictModel
from .safety_change_quorum_canonical import HASH, ID, digest, normal

class QualificationEvidence(StrictModel):
    model_config=ConfigDict(extra="forbid", frozen=True, strict=True)
    workforce_person: str = Field(pattern=ID); trust: Literal["synthetic_untrusted"]
    feature17_status: Literal["unknown"]; roles: list[Literal["safety_operator","incident_commander"]]
    state: Literal["active","stale","revoked","disputed","unknown"]; observed_at: datetime; evidence_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.roles != sorted(set(self.roles)) or not HASH.fullmatch(self.evidence_hash) or self.evidence_hash != digest(self.model_dump(exclude={"evidence_hash"})): raise ValueError("qualification invalid")
        return self

class HumanApprovalAttestation(StrictModel):
    model_config=ConfigDict(extra="forbid", frozen=True, strict=True)
    request_hash: str; workforce_person: str = Field(pattern=ID); account_fingerprint: str = Field(pattern=ID)
    principal_kind: Literal["human","service","model"]; role: Literal["safety_operator","incident_commander"]
    qualification_hash: str; approved_at: datetime; approval_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.request_hash,self.qualification_hash,self.approval_hash)) or self.approval_hash != digest(self.model_dump(exclude={"approval_hash"})): raise ValueError("attestation invalid")
        return self

class ChangeQuorumDecision(StrictModel):
    model_config=ConfigDict(extra="forbid", frozen=True, strict=True)
    request_hash: str; outcome: str; counted_people: list[str]; rejected_reason_codes: list[str]; product_qualification_status: Literal["unknown"]="unknown"; decision_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.counted_people != sorted(set(self.counted_people)) or self.rejected_reason_codes != sorted(set(self.rejected_reason_codes)) or self.decision_hash != digest(self.model_dump(exclude={"decision_hash"})): raise ValueError("decision invalid")
        return self

class AppliedChangeReceipt(StrictModel):
    model_config=ConfigDict(extra="forbid", frozen=True, strict=True)
    request_hash: str; decision_hash: str; status: Literal["simulated_success","simulated_failure","simulated_partial","blocked"]; reason_codes: list[str]; receipt_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.reason_codes != sorted(set(self.reason_codes)) or self.receipt_hash != digest(self.model_dump(exclude={"receipt_hash"})): raise ValueError("receipt invalid")
        return self
