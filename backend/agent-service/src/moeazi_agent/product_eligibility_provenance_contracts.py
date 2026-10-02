"""Metadata-only provenance contracts.  They deliberately contain no source text."""
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import Field,model_validator
from .product_eligibility_scope_contracts import Frozen
from .product_eligibility_canonical import digest
class EligibilitySourceReference(Frozen):
 source_id:str=Field(pattern=r"^source:[a-z0-9-]{3,64}$"); revision:int=Field(ge=1); predecessor_hash:str|None=Field(default=None,pattern=r"^[a-f0-9]{64}$"); publisher_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); snapshot_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); applicability_review_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); retention_policy_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); lifecycle_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); feature21_context_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); status:Literal["current","superseded","expired","disputed","withdrawn","unverifiable"]; provenance:Literal["synthetic_untrusted"]="synthetic_untrusted"; effective_at:datetime; expires_at:datetime; source_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.expires_at<=self.effective_at or (self.revision==1)!=(self.predecessor_hash is None) or self.source_hash!=digest(self.model_dump(exclude={"source_hash"},mode="python")): raise ValueError("source_invalid")
  return self
class RuleOwnerClaim(Frozen):
 principal_fingerprint:str=Field(pattern=r"^[a-f0-9]{64}$"); role:Literal["legal_author","legal_approver","compliance_reviewer"]; authority_scope_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); source_set_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); effective_at:datetime; expires_at:datetime; provenance:Literal["synthetic_untrusted"]="synthetic_untrusted"; product_qualification:Literal["unknown"]="unknown"; claim_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.expires_at<=self.effective_at or self.claim_hash!=digest(self.model_dump(exclude={"claim_hash"},mode="python")): raise ValueError("owner_claim_invalid")
  return self
class EligibilityAttributeAssertion(Frozen):
 scope_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); dimension:Literal["jurisdiction","customer"]; key:str; value:str; source_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); collection_basis_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); lifecycle_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); source_kind:Literal["authoritative_fixture","self_attestation_fixture"]; status:Literal["current","expired","disputed","ambiguous","superseded"]; effective_at:datetime; expires_at:datetime; assertion_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.expires_at<=self.effective_at or self.assertion_hash!=digest(self.model_dump(exclude={"assertion_hash"},mode="python")): raise ValueError("attribute_assertion_invalid")
  return self
class ProductVersionBinding(Frozen):
 product_id:str=Field(pattern=r"^product:[a-z0-9-]{3,64}$"); product_class:Literal["spot","perpetual"]; revision:int=Field(ge=1); definition_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); chain_id:Literal[42161]; feature07_status:Literal["requires_revalidation"]; lifecycle_status:Literal["active","restricted","disputed","rebaseline_required","expired"]; effective_at:datetime; expires_at:datetime; binding_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.expires_at<=self.effective_at or self.binding_hash!=digest(self.model_dump(exclude={"binding_hash"},mode="python")): raise ValueError("product_binding_invalid")
  return self
class VenueBinding(Frozen):
 venue:str; registry_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); provenance:Literal["synthetic_untrusted"]="synthetic_untrusted"; status:Literal["current","expired","disputed"]; effective_at:datetime; expires_at:datetime; binding_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.expires_at<=self.effective_at or self.binding_hash!=digest(self.model_dump(exclude={"binding_hash"},mode="python")): raise ValueError("venue_binding_invalid")
  return self
