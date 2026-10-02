"""Strict causal contracts for the synthetic Test Center confirmation ceremony."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

Hash=str
class Frozen(BaseModel): model_config=ConfigDict(extra="forbid",frozen=True,strict=True)
class SemanticDiffItem(Frozen): field:str; before_hash:Hash|None=None; after_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); direction:Literal["tightening","loosening","neutral","mixed","unknown"]; reason_code:str
class PolicySemanticDiff(Frozen): scope_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); before_policy_hash:Hash|None=None; after_policy_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); compiler_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); registry_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); items:tuple[SemanticDiffItem,...]; aggregate:Literal["no_change","tightening_only","contains_loosening","mixed","unknown"]; diff_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
class PolicyConsentChallenge(Frozen):
    scope_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); tenant_fingerprint:str=Field(pattern=r"^tenant:[a-z0-9:_-]{1,64}$"); user_fingerprint:str=Field(pattern=r"^user:[a-z0-9:_-]{1,64}$"); account_fingerprint:str=Field(pattern=r"^account:[a-z0-9:_-]{1,64}$"); confirmer_fingerprint:str=Field(pattern=r"^user:[a-z0-9:_-]{1,64}$"); mandate_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); revision:int=Field(ge=1); predecessor_hash:Hash|None=None; prior_activation_hash:Hash|None=None; policy_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); profile_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); map_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); coverage_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); test_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); compiler_version:Literal["mandate-policy-compiler-v1"]; schema_version:Literal["mandate-spec-v1"]; registry_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); diff_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); request_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); idempotency_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); nonce_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); binding_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); issued_at:datetime; expires_at:datetime; use_count:Literal[0]=0; kind:Literal["standard","material_change"]
    @model_validator(mode="after")
    def _ttl(self):
        if any(value.tzinfo is None or value.utcoffset()!=timezone.utc.utcoffset(value) for value in (self.issued_at,self.expires_at)) or self.expires_at<=self.issued_at or (self.expires_at-self.issued_at).total_seconds()>600: raise ValueError("invalid_challenge_ttl")
        return self
class PolicyConsentReceipt(Frozen):
    challenge_nonce_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); binding_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); confirmer_fingerprint:str=Field(pattern=r"^user:[a-z0-9:_-]{1,64}$"); challenge_issued_at:datetime; challenge_expires_at:datetime; confirmed_at:datetime; outcome:Literal["confirmed","declined"]; use_count:Literal[1]; consent_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
    @model_validator(mode="after")
    def _confirmed(self):
        if any(item.tzinfo is None or item.utcoffset()!=timezone.utc.utcoffset(item) for item in (self.challenge_issued_at,self.challenge_expires_at,self.confirmed_at)) or not self.challenge_issued_at<=self.confirmed_at<=self.challenge_expires_at: raise ValueError("invalid_confirmation_time")
        return self
class PolicyActivationReceipt(Frozen):
    scope_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); activation_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); predecessor_hash:Hash|None=None; sequence:int=Field(ge=1); consent_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); policy_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); profile_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); compilation_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); request_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); idempotency_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); activated_at:datetime; result:Literal["simulated_activated"]
    @model_validator(mode="after")
    def _activated(self):
        if self.activated_at.tzinfo is None or self.activated_at.utcoffset()!=timezone.utc.utcoffset(self.activated_at): raise ValueError("invalid_activation_time")
        return self
class PolicyBoundaryReceipt(Frozen): activation_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); history_append_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); non_authorizing:Literal[True]=True; accepted_for_product:Literal[False]=False; product_status:Literal["unavailable"]="unavailable"; effective_authority_status:Literal["unavailable"]="unavailable"; authority_effect:Literal["none"]="none"; boundary_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
