"""Narrow, one-use local fixture lease contracts."""
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import ConfigDict, Field, model_validator
from .contracts import StrictModel
from .safety_change_quorum_canonical import HASH, ID, digest

Capability=Literal["inspect","reconcile","disable","isolate","rotate_service_credential","restore_exact_known_good"]
class BreakGlassLease(StrictModel):
    model_config=ConfigDict(extra="forbid", frozen=True, strict=True)
    incident_id: str = Field(pattern=ID); subject_person: str = Field(pattern=ID); capabilities: list[Capability]
    expires_at: datetime; nonce: str = Field(pattern=ID); issuance_decision_hash: str; baseline_hash: str; lease_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.capabilities != sorted(set(self.capabilities)) or not all(HASH.fullmatch(x) for x in (self.issuance_decision_hash,self.baseline_hash,self.lease_hash)) or self.lease_hash != digest(self.model_dump(exclude={"lease_hash"})): raise ValueError("lease invalid")
        return self
class BreakGlassUseReceipt(StrictModel):
    model_config=ConfigDict(extra="forbid", frozen=True, strict=True)
    lease_hash: str; nonce: str = Field(pattern=ID); status: Literal["simulated_success","blocked","paused_fail_closed"]; reason_codes: list[str]; receipt_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.reason_codes != sorted(set(self.reason_codes)) or self.receipt_hash != digest(self.model_dump(exclude={"receipt_hash"})): raise ValueError("lease use invalid")
        return self
