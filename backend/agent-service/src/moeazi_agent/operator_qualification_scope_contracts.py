"""Versioned, synthetic scope and training contracts; no workforce data is accepted."""
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import ConfigDict, Field, model_validator
from .contracts import StrictModel
from .operator_qualification_canonical import HASH, ID, digest, normal


class _QualificationModel(StrictModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    @model_validator(mode="before")
    @classmethod
    def canonical(cls, value): normal(value); return value


class QualificationScope(_QualificationModel):
    tenant_fingerprint: str = Field(pattern=ID); scope_id: str = Field(pattern=ID)
    environment: Literal["local", "test"]; scope_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.scope_hash) or self.scope_hash != digest(self.model_dump(exclude={"scope_hash"})): raise ValueError("scope hash invalid")
        return self


class SyntheticWorkforcePrincipal(_QualificationModel):
    person_fingerprint: str = Field(pattern=ID); account_fingerprint: str = Field(pattern=ID)
    principal_kind: Literal["human", "service", "model"]; trust: Literal["synthetic_untrusted"]
    principal_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.principal_hash) or self.principal_hash != digest(self.model_dump(exclude={"principal_hash"})): raise ValueError("principal invalid")
        return self


class OperatorRoleVersion(_QualificationModel):
    scope_hash: str; role: Literal["safety_change_approver", "incident_commander", "incident_communications_operator", "strategy_termination_operator", "recovery_operator"]
    version: str = Field(pattern=ID); registry_hash: str; role_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.scope_hash, self.registry_hash, self.role_hash)) or self.role_hash != digest(self.model_dump(exclude={"role_hash"})): raise ValueError("role invalid")
        return self


class TrainingModuleVersion(_QualificationModel):
    scope_hash: str; module_id: str = Field(pattern=ID); version: str = Field(pattern=ID); role_hash: str; module_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.scope_hash, self.role_hash, self.module_hash)) or self.module_hash != digest(self.model_dump(exclude={"module_hash"})): raise ValueError("module invalid")
        return self


class TrainingCompletionReceipt(_QualificationModel):
    scope_hash: str; principal_hash: str; module_hash: str; completed_at: datetime; receipt_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.scope_hash, self.principal_hash, self.module_hash, self.receipt_hash)) or self.receipt_hash != digest(self.model_dump(exclude={"receipt_hash"})): raise ValueError("training receipt invalid")
        return self


class FrozenQualificationManifest(_QualificationModel):
    scope_hash: str; registry_hash: str; policy_hash: str; artifact_hashes: list[str]; manifest_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.artifact_hashes != sorted(set(self.artifact_hashes)) or not all(HASH.fullmatch(x) for x in self.artifact_hashes + [self.scope_hash, self.registry_hash, self.policy_hash, self.manifest_hash]) or self.manifest_hash != digest(self.model_dump(exclude={"manifest_hash"})): raise ValueError("manifest invalid")
        return self
