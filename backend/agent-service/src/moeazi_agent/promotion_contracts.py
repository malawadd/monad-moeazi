"""Immutable, strict contracts for Feature 36; no product configuration mutation."""
from __future__ import annotations
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .promotion_canonical import digest, hash_value, utc

class Strict(BaseModel): model_config = ConfigDict(frozen=True, extra="forbid", strict=True)
class PromotionScope(Strict):
    operator_id: str = Field(pattern=r"^[a-z0-9-]{3,80}$"); tenant_fixture: str; account_fixture: str
    markets: tuple[str, ...]; horizons: tuple[str, ...]; regimes: tuple[str, ...]; purpose: str = "promotion-research"; chain_id: int = 42161; scope_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.chain_id != 42161 or not self.markets or tuple(sorted(set(self.markets))) != self.markets: raise ValueError("scope")
        if self.scope_hash != digest(self.model_dump(exclude={"scope_hash"})): raise ValueError("scope_hash")
        return self
class ConfigurationSnapshot(Strict):
    configuration_id: str; version: int = Field(ge=1); owner: str; purpose: str; tier: str
    ordered_roles: tuple[str, ...]; quorum: int = Field(ge=1); critical_roles: tuple[str, ...]; model_families: tuple[str, ...]
    route_hash: str; prompt_bundle_hash: str; evidence_schema_hash: str; policy_hash: str; expires_at: str; configuration_hash: str
    @model_validator(mode="after")
    def valid(self):
        for value in (self.route_hash,self.prompt_bundle_hash,self.evidence_schema_hash,self.policy_hash): hash_value(value)
        utc(self.expires_at)
        if tuple(sorted(set(self.critical_roles))) != self.critical_roles or self.configuration_hash != digest(self.model_dump(exclude={"configuration_hash"})): raise ValueError("configuration")
        return self
class CandidateSpec(Strict):
    candidate_id: str; trial_id: str; candidate: ConfigurationSnapshot; champion: ConfigurationSnapshot; lineage: tuple[str, ...]
    exposure_ceiling_bps: int = Field(ge=0); cost_ceiling_microusd: int = Field(ge=0); latency_ceiling_micros: int = Field(ge=0)
    created_at: str; expires_at: str; candidate_hash: str
    @model_validator(mode="after")
    def valid(self):
        utc(self.created_at); utc(self.expires_at)
        if not self.lineage or self.candidate.configuration_hash == self.champion.configuration_hash or self.candidate_hash != digest(self.model_dump(exclude={"candidate_hash"})): raise ValueError("candidate")
        return self
class PrerequisiteBinding(Strict):
    feature_id: str; run_id: str; request_hash: str; control_hash: str; registry_hash: str; fixture_hash: str; result_hash: str; root_hash: str; persistence_receipt_hash: str; audit_snapshot_hash: str
    selected_at: str; as_of: str; trust_status: str = "requires_revalidation"; non_authorizing: bool = True; zero_attempts: bool
    @model_validator(mode="after")
    def valid(self):
        if self.feature_id not in {"calibrated-shadow-execution-tca","outcome-linked-decision-memory"} or self.trust_status != "requires_revalidation" or not self.non_authorizing or not self.zero_attempts: raise ValueError("binding")
        utc(self.selected_at); utc(self.as_of)
        for value in self.model_dump(include={"request_hash","control_hash","registry_hash","fixture_hash","result_hash","root_hash","persistence_receipt_hash","audit_snapshot_hash"}).values(): hash_value(value)
        return self
class PromotionPlan(Strict):
    candidate_hash: str; champion_hash: str; rollback_target_hash: str; cutoff_at: str; required_raw_pairs: int = Field(ge=1); required_effective_pairs: int = Field(ge=1)
    alpha_bps: int = Field(ge=1, le=1000); improvement_bps: int = Field(ge=0); noninferiority_bps: int = Field(ge=0, le=200)
    max_missing_bps: int = Field(ge=0, le=10000); maximum_cost_microusd: int = Field(ge=0); maximum_latency_micros: int = Field(ge=0); trial_family_size: int = Field(ge=1); plan_hash: str
    @model_validator(mode="after")
    def valid(self):
        utc(self.cutoff_at)
        for value in (self.candidate_hash,self.champion_hash,self.rollback_target_hash): hash_value(value)
        if self.required_effective_pairs > self.required_raw_pairs or self.plan_hash != digest(self.model_dump(exclude={"plan_hash"})): raise ValueError("plan")
        return self
