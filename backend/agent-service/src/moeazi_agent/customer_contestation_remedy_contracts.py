from __future__ import annotations
from typing import Literal
from pydantic import Field,model_validator
from .customer_contestation_scope_contracts import Frozen
from .customer_contestation_canonical import digest
class RemedyProposal(Frozen):
 case_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); finding_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); remedy_type:Literal["none","financial","correction"]; minor_units:int=Field(ge=0); asset_code:str=Field(pattern=r"^[A-Z]{2,12}$"); chain_id:Literal[42161]; proposal_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if (self.remedy_type=="financial") != bool(self.minor_units) or self.proposal_hash!=digest(self.model_dump(exclude={"proposal_hash"},mode="python")): raise ValueError("remedy_proposal_invalid")
  return self
class RemedyAuthorization(Frozen):
 proposal_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); authorizer_fingerprint:str=Field(pattern=r"^authorizer:[a-z0-9-]{3,64}$"); status:Literal["authorized","declined"]; authorization_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.authorization_hash!=digest(self.model_dump(exclude={"authorization_hash"},mode="python")): raise ValueError("remedy_authorization_invalid")
  return self
class RemedyExecutionReceipt(Frozen):
 authorization_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); status:Literal["simulated_not_executed","declined","failed","uncertain"]; operation_performed:Literal[False]=False; receipt_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.receipt_hash!=digest(self.model_dump(exclude={"receipt_hash"},mode="python")): raise ValueError("remedy_receipt_invalid")
  return self
class CaseClosureReceipt(Frozen):
 case_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); state_head_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); closure_eligible:bool; receipt_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
