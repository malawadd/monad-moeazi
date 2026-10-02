from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import Field,model_validator
from .customer_contestation_scope_contracts import Frozen
from .customer_contestation_canonical import digest
class CustomerResponse(Frozen):
 case_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); finding_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); outcome:Literal["delivered","failed","pending"]; requested_at:datetime; response_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.response_hash!=digest(self.model_dump(exclude={"response_hash"},mode="python")): raise ValueError("response_hash_mismatch")
  return self
class ResponseDeliveryReceipt(Frozen):
 response_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); status:Literal["delivered","failed","pending"]; receipt_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.receipt_hash!=digest(self.model_dump(exclude={"receipt_hash"},mode="python")): raise ValueError("delivery_hash_mismatch")
  return self
class AppealRequest(Frozen):
 case_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); finding_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); ground:Literal["evidence","process","scope"]; requested_at:datetime; appeal_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.appeal_hash!=digest(self.model_dump(exclude={"appeal_hash"},mode="python")): raise ValueError("appeal_hash_mismatch")
  return self
class ReviewerEligibilityBinding(Frozen):
 reviewer_fingerprint:str=Field(pattern=r"^reviewer:[a-z0-9-]{3,64}$"); status:Literal["requires_revalidation"]; binding_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
class AppealDecision(Frozen):
 appeal_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); case_head_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); reviewer:ReviewerEligibilityBinding; outcome:Literal["upheld","amended","declined"]; decision_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.decision_hash!=digest(self.model_dump(exclude={"decision_hash"},mode="python")): raise ValueError("appeal_decision_invalid")
  return self
