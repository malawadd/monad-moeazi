"""Frozen, float-free contracts for Feature 38 local fixtures."""
from __future__ import annotations
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .analytical_diversity_canonical import digest, hash_value, utc
class Strict(BaseModel): model_config = ConfigDict(frozen=True, extra="forbid", strict=True)
class AuditScope(Strict):
 operator_id: str = Field(pattern=r"^[a-z0-9_-]{3,80}$"); tenant_fixture: str; account_fixture: str; market: str; horizon: str; purpose: str = "analytical-diversity-audit"; chain_id: int = 42161; cutoff_at: str; embargo_bps: int = Field(ge=0); scope_hash: str
 @model_validator(mode="after")
 def valid(self):
  utc(self.cutoff_at)
  if self.chain_id != 42161 or self.scope_hash != digest(self.model_dump(exclude={"scope_hash"})): raise ValueError("scope")
  return self
class AnalyticalPathIdentity(Strict):
 role: str; canonical_family: str; requested_model: str; served_model: str; provider: str; gateway: str; route_version: str; prompt_version: str; schema_version: str; evidence_version: str; retrieval_version: str; claim_ids: tuple[str, ...]; cluster_ids: tuple[str, ...]; decision_at: str; identity_hash: str
 @model_validator(mode="after")
 def valid(self):
  utc(self.decision_at); hash_value(self.identity_hash)
  if not self.canonical_family or len(set(self.claim_ids)) != len(self.claim_ids) or len(set(self.cluster_ids)) != len(self.cluster_ids): raise ValueError("identity")
  return self
class PathObservation(Strict):
 path_hash: str; identity_hash: str; direction: str; predicted_return_bps: int; realized_return_bps: int; confidence_bps: int = Field(ge=0, le=10000); abstained: bool = False
 @model_validator(mode="after")
 def valid(self): hash_value(self.path_hash); hash_value(self.identity_hash); return self
class PrerequisiteRunBinding(Strict):
 feature_id: str; run_id: str; result_hash: str; root_hash: str; trust_status: str = "requires_revalidation"; zero_attempts: bool = True
 @model_validator(mode="after")
 def valid(self): hash_value(self.result_hash); hash_value(self.root_hash); return self
