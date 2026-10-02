from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import Field,model_validator
from .customer_contestation_scope_contracts import Frozen
from .customer_contestation_canonical import digest
from .customer_contestation_registry import members
class InvestigationScope(Frozen):
 case_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); reviewer_fingerprint:str=Field(pattern=r"^reviewer:[a-z0-9-]{3,64}$"); qualification_status:Literal["requires_revalidation"]; scope_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); investigation_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.investigation_hash!=digest(self.model_dump(exclude={"investigation_hash"},mode="python")): raise ValueError("investigation_hash_mismatch")
  return self
class InvestigationEvidenceReference(Frozen):
 investigation_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); owner:str=Field(pattern=r"^[a-z0-9-]{3,64}$"); artifact_type:str=Field(pattern=r"^[a-z0-9-]{3,64}$"); artifact_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); revision:int=Field(ge=1); scope_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); observed_at:datetime; expires_at:datetime; lifecycle_status:Literal["current","stale","disputed","unknown"]; citation_label:str=Field(pattern=r"^[A-Z0-9_-]{3,64}$"); reference_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.expires_at<=self.observed_at or self.reference_hash!=digest(self.model_dump(exclude={"reference_hash"},mode="python")): raise ValueError("evidence_reference_invalid")
  return self
class InvestigationActionReceipt(Frozen):
 investigation_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); action_code:Literal["collect","verify","compare"]; observed_at:datetime; action_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.action_hash!=digest(self.model_dump(exclude={"action_hash"},mode="python")): raise ValueError("action_hash_mismatch")
  return self
class CaseFinding(Frozen):
 case_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); investigation_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); reviewer_fingerprint:str=Field(pattern=r"^reviewer:[a-z0-9-]{3,64}$"); outcome:Literal["substantiated","partial","not_substantiated","insufficient_evidence","outside_scope","duplicate","withdrawn"]; citation_hashes:tuple[str,...]; reason_codes:tuple[str,...]; issued_at:datetime; finding_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if not self.citation_hashes or self.reason_codes!=tuple(sorted(set(self.reason_codes))) or self.finding_hash!=digest(self.model_dump(exclude={"finding_hash"},mode="python")): raise ValueError("finding_invalid")
  return self
class DomainCorrectionIntent(Frozen):
 case_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); predecessor_hash:str|None=None; domain_owner:str=Field(pattern=r"^[a-z0-9-]{3,64}$"); correction_code:Literal["append","supersede"]; intent_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.intent_hash!=digest(self.model_dump(exclude={"intent_hash"},mode="python")): raise ValueError("correction_intent_invalid")
  return self
class DomainCorrectionReceipt(Frozen):
 intent_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); predecessor_hash:str|None=None; status:Literal["recorded","pending","uncertain"]; receipt_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.receipt_hash!=digest(self.model_dump(exclude={"receipt_hash"},mode="python")): raise ValueError("correction_receipt_invalid")
  return self
