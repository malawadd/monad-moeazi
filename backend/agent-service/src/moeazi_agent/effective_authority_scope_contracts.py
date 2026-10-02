"""Scope and request contracts; no wallet, network, or customer identifiers."""
from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .effective_authority_canonical import digest

Hash = str
class Frozen(BaseModel): model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
class AuthorityScope(Frozen):
    tenant_fingerprint: str = Field(pattern=r"^tenant:[a-z0-9:_-]{1,64}$")
    account_fingerprint: str = Field(pattern=r"^account:[a-z0-9:_-]{1,64}$")
    strategy_fingerprint: str = Field(pattern=r"^strategy:[a-z0-9:_-]{1,64}$")
    chain_id: Literal[42161] = 42161
    scope_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    @model_validator(mode="after")
    def _hash(self):
        if self.scope_hash != digest(self.model_dump(exclude={"scope_hash"})): raise ValueError("scope_hash_mismatch")
        return self
class BoundaryIdentity(Frozen):
    boundary: Literal["analysis","proposal","approval","preflight","pre_dispatch","submission","reconciliation"]
    action: Literal["analyze","simulate","preflight","submit","reconcile"]
    proposal_hash: Hash | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    approval_hash: Hash | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    workflow_hash: Hash | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    @model_validator(mode="after")
    def _bindings(self):
        if self.action == "submit" and self.boundary not in {"pre_dispatch","submission"}: raise ValueError("submit_boundary_mismatch")
        return self
class ProjectionRequest(Frozen):
    scope: AuthorityScope; boundary: BoundaryIdentity
    analysis_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    idempotency_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    request_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
