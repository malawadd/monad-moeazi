"""Strict scope and Feature 25 binding contracts; both remain non-authorizing."""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .decision_memory_canonical import digest, require_hash, require_id, utc


class Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", strict=True)


class DecisionMemoryScope(Frozen):
    operator_id: str = Field(min_length=8, max_length=80)
    tenant_fixture: str = Field(pattern=r"^[a-z0-9-]{3,79}$")
    account_fixture: str = Field(pattern=r"^[a-z0-9-]{3,79}$")
    chain_id: Literal[42161] = 42161
    market: str = Field(pattern=r"^[a-z0-9-]{3,79}$")
    horizon: str = Field(pattern=r"^[a-z0-9-]{3,79}$")
    regime: str = Field(pattern=r"^[a-z0-9-]{3,79}$")
    role: str = Field(pattern=r"^[a-z0-9-]{3,79}$")
    permission_scope: Literal["fixture-inspection"] = "fixture-inspection"
    scope_hash: str

    @model_validator(mode="after")
    def closed(self):
        if self.scope_hash != digest(self.model_dump(exclude={"scope_hash"}, mode="json")):
            raise ValueError("decision_memory_scope_hash")
        return self


class SelectedEvidenceEventBinding(Frozen):
    run_id: str
    request_hash: str
    control_hash: str
    registry_hash: str
    fixture_hash: str
    result_hash: str
    audit_snapshot_hash: str
    scope_hash: str
    selected_at: str
    trust_status: Literal["requires_revalidation"] = "requires_revalidation"
    implementation_pass: Literal[True] = True
    fixture_only: Literal[True] = True
    product_outcome: Literal["unavailable"] = "unavailable"
    non_authorizing: Literal[True] = True
    binding_hash: str

    @model_validator(mode="after")
    def closed(self):
        require_id(self.run_id); utc(self.selected_at)
        for value in (self.request_hash, self.control_hash, self.registry_hash, self.fixture_hash,
                      self.result_hash, self.audit_snapshot_hash, self.scope_hash):
            require_hash(value)
        if self.binding_hash != digest(self.model_dump(exclude={"binding_hash"}, mode="json")):
            raise ValueError("decision_memory_binding_hash")
        return self
