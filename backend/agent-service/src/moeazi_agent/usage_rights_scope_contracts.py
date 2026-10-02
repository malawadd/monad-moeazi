"""Scope and Feature 03 context contracts; all references are synthetic hashes."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .usage_rights_canonical import digest


class Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class UsageRightsScope(Frozen):
    tenant_fingerprint: str = Field(pattern=r"^tenant:[a-z0-9-]{3,64}$")
    operator_fingerprint: str = Field(pattern=r"^operator:[a-z0-9-]{3,64}$")
    account_fingerprint: str = Field(pattern=r"^account:[a-z0-9-]{3,64}$")
    chain_id: Literal[42161]
    environment: Literal["local", "test"]
    scope_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def check_hash(self):
        if self.scope_hash != digest(self.model_dump(exclude={"scope_hash"}, mode="python")):
            raise ValueError("scope_hash_mismatch")
        return self


class Feature03ContextBinding(Frozen):
    run_id: str = Field(pattern=r"^run-[a-f0-9]{32}$")
    scope_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    operator_fingerprint: str = Field(pattern=r"^operator:[a-z0-9-]{3,64}$")
    decision_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    policy_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    status: Literal["unavailable", "requires_revalidation"]
    frozen_at: datetime
    binding_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def check(self):
        if self.frozen_at.tzinfo is None or self.frozen_at.utcoffset() != timezone.utc.utcoffset(self.frozen_at):
            raise ValueError("feature03_utc_required")
        if self.binding_hash != digest(self.model_dump(exclude={"binding_hash"}, mode="python")):
            raise ValueError("feature03_binding_hash_mismatch")
        return self
