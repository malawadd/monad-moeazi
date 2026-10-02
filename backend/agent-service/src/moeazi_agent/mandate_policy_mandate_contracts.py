"""Strict authority contracts.  Projections are intentionally advisory only."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .mandate_policy_canonical import digest


class Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class MandateScope(Frozen):
    tenant_fingerprint: str = Field(pattern=r"^tenant:[a-z0-9-]{3,64}$")
    user_fingerprint: str = Field(pattern=r"^user:[a-z0-9-]{3,64}$")
    strategy_account_fingerprint: str = Field(pattern=r"^account:[a-z0-9-]{3,64}$")
    chain_id: Literal[42161]
    environment: Literal["local", "test"]
    effective_at: datetime
    expires_at: datetime | None = None
    scope_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def _times(self):
        if self.effective_at.tzinfo is None or self.effective_at.utcoffset()!=timezone.utc.utcoffset(self.effective_at):
            raise ValueError("scope_utc_required")
        if self.expires_at and (self.expires_at.tzinfo is None or self.expires_at.utcoffset()!=timezone.utc.utcoffset(self.expires_at)):
            raise ValueError("scope_utc_required")
        if self.expires_at and self.expires_at <= self.effective_at:
            raise ValueError("expiry_must_follow_effective")
        body=self.model_dump(exclude={"scope_hash"},mode="python")
        if self.scope_hash!=digest(body): raise ValueError("scope_hash_mismatch")
        return self


class MandateClause(Frozen):
    clause_id: str = Field(pattern=r"^clause:[a-z0-9-]{3,64}$")
    field: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9]*$")
    operator: Literal["equals", "subset", "max", "min", "required", "exact"]
    value: int | bool | str | tuple[str, ...]
    unit: str = Field(pattern=r"^[a-z_]+$")

    @model_validator(mode="after")
    def _set(self):
        if isinstance(self.value, tuple) and (not self.value or tuple(sorted(set(self.value))) != self.value):
            raise ValueError("set_values_must_be_sorted_unique")
        return self


class ExplicitDefaultAcceptance(Frozen):
    field: str
    value: int | bool | str | tuple[str, ...]
    unit: str
    registry_version: str
    source_default_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class MandateSpec(Frozen):
    mandate_id: str = Field(pattern=r"^mandate:[a-z0-9-]{3,64}$")
    revision: int = Field(ge=1)
    predecessor_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    scope: MandateScope
    schema_version: Literal["mandate-spec-v1"] = "mandate-spec-v1"
    registry_version: str
    clauses: tuple[MandateClause, ...]
    explicit_defaults: tuple[ExplicitDefaultAcceptance, ...] = ()
    mandate_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def _unique(self):
        ids = [item.clause_id for item in self.clauses]
        if not ids or ids != sorted(ids) or len(ids) != len(set(ids)):
            raise ValueError("clauses_must_be_sorted_unique")
        fields = [item.field for item in self.explicit_defaults]
        if fields != sorted(fields) or len(fields) != len(set(fields)):
            raise ValueError("defaults_must_be_sorted_unique")
        body=self.model_dump(exclude={"mandate_hash"},mode="python")
        if self.mandate_hash!=digest(body): raise ValueError("mandate_hash_mismatch")
        return self


class DraftClauseProjection(Frozen):
    source_span: tuple[int, int]
    status: Literal["supported", "ambiguous", "unsupported", "contradictory"]
    candidate_fields: tuple[str, ...] = ()


class PolicyDraftProjection(Frozen):
    source_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    clauses: tuple[DraftClauseProjection, ...]
    advisory_only: Literal[True] = True
