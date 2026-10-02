"""Strict synthetic scope; never accepts a wallet address or product identity."""
from __future__ import annotations
from typing import Literal
from pydantic import BaseModel,ConfigDict,Field,model_validator
from .risk_tiered_consent_canonical import digest
Hash=str
class Frozen(BaseModel): model_config=ConfigDict(extra="forbid",frozen=True,strict=True)
class ConsentScope(Frozen):
    tenant_fingerprint:str=Field(pattern=r"^tenant:[a-z0-9:_-]{1,64}$")
    account_fingerprint:str=Field(pattern=r"^account:[a-z0-9:_-]{1,64}$")
    strategy_fingerprint:str=Field(pattern=r"^strategy:[a-z0-9:_-]{1,64}$")
    proposal_fingerprint:str=Field(pattern=r"^proposal:[a-z0-9:_-]{1,64}$")
    owner_fingerprint:str=Field(pattern=r"^owner:[a-z0-9:_-]{1,64}$")
    owner_provider:Literal["particle","magic"]
    chain_id:Literal[42161]=42161
    scope_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
    @model_validator(mode="after")
    def verify_hash(self):
        if self.scope_hash!=digest(self.model_dump(exclude={"scope_hash"})): raise ValueError("scope_hash_mismatch")
        return self
class ApprovalRequest(Frozen):
    mode:Literal["Shadow","Approval","Autopilot"]
    boundary:Literal["approval"]="approval"
    action:Literal["submit"]="submit"
    request_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
    idempotency_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
