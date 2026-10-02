"""Metadata-only source-chain contracts; terms and remote locations are forbidden."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Literal
from pydantic import Field, model_validator
from .usage_rights_scope_contracts import Frozen, UsageRightsScope
from .usage_rights_canonical import digest


class UsageRightsSourceReference(Frozen):
    source_id: str = Field(pattern=r"^source:[a-z0-9-]{3,64}$")
    scope: UsageRightsScope
    revision: int = Field(ge=1, le=999999)
    predecessor_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    agreement_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    plan_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    terms_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    license_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    owner_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    status: Literal["current", "expired", "disputed", "superseded"]
    provenance: Literal["synthetic_untrusted"]
    effective_at: datetime
    expires_at: datetime
    source_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def check(self):
        if self.effective_at.tzinfo is None or self.expires_at.tzinfo is None or self.expires_at <= self.effective_at:
            raise ValueError("source_interval_invalid")
        if (self.revision == 1) != (self.predecessor_hash is None):
            raise ValueError("source_predecessor_invalid")
        if self.source_hash != digest(self.model_dump(exclude={"source_hash"}, mode="python")):
            raise ValueError("source_hash_mismatch")
        return self
