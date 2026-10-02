"""Exact local/test scope identities; no product tenant binding exists here."""
from __future__ import annotations
from typing import Literal
from pydantic import ConfigDict, Field, model_validator
from .contracts import StrictModel
from .safety_change_quorum_canonical import HASH, ID, digest, normal

class SafetyScope(StrictModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    tenant_fingerprint: str = Field(pattern=ID); scope_id: str = Field(pattern=ID)
    environment: Literal["local", "test"]; scope_hash: str
    @model_validator(mode="before")
    @classmethod
    def canonical(cls, value): normal(value); return value
    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.scope_hash) or self.scope_hash != digest(self.model_dump(exclude={"scope_hash"})):
            raise ValueError("scope hash invalid")
        return self
