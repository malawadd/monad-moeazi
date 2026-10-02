from __future__ import annotations
from datetime import datetime,timezone
from typing import Literal
from pydantic import BaseModel,ConfigDict,Field,model_validator
from .customer_contestation_canonical import digest
class Frozen(BaseModel): model_config=ConfigDict(extra="forbid",frozen=True,strict=True)
class ContestationScope(Frozen):
 tenant_fingerprint:str=Field(pattern=r"^tenant:[a-z0-9-]{3,64}$"); operator_fingerprint:str=Field(pattern=r"^operator:[a-z0-9-]{3,64}$"); account_fingerprint:str=Field(pattern=r"^account:[a-z0-9-]{3,64}$"); customer_fingerprint:str=Field(pattern=r"^customer:[a-z0-9-]{3,64}$"); chain_id:Literal[42161]; scope_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.scope_hash!=digest(self.model_dump(exclude={"scope_hash"},mode="python")): raise ValueError("scope_hash_mismatch")
  return self
class SyntheticPrincipalBinding(Frozen):
 scope_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); principal_fingerprint:str=Field(pattern=r"^(customer|representative):[a-z0-9-]{3,64}$"); representative_authorization_hash:str|None=None; status:Literal["synthetic_verified","requires_revalidation"]; binding_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.principal_fingerprint.startswith("representative:") != bool(self.representative_authorization_hash): raise ValueError("representative_binding_required")
  if self.binding_hash!=digest(self.model_dump(exclude={"binding_hash"},mode="python")): raise ValueError("principal_hash_mismatch")
  return self
class Feature20ContextBinding(Frozen):
 run_id:str=Field(pattern=r"^run-[a-f0-9]{32}$"); scope_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); operator_fingerprint:str=Field(pattern=r"^operator:[a-z0-9-]{3,64}$"); fixture_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); request_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); status:Literal["requires_revalidation"]; accepted_as_consent:Literal[False]=False; product_outcome:Literal["unavailable"]="unavailable"; authority_effect:Literal["none"]="none"; operation_performed:Literal[False]=False; expires_at:datetime; binding_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.expires_at.tzinfo is None or self.expires_at.utcoffset()!=timezone.utc.utcoffset(self.expires_at): raise ValueError("feature20_utc_required")
  if self.binding_hash!=digest(self.model_dump(exclude={"binding_hash"},mode="python")): raise ValueError("feature20_hash_mismatch")
  return self
class EvidenceLifecycleBinding(Frozen):
 scope_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); status:Literal["current","stale","disputed","unknown"]; lifecycle_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
