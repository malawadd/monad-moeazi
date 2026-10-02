from __future__ import annotations
from datetime import datetime,timezone
from typing import Literal
from pydantic import Field,model_validator
from .customer_contestation_scope_contracts import Frozen,ContestationScope
from .customer_contestation_canonical import digest
from .customer_contestation_registry import limit
class ContestationPolicyVersion(Frozen):
 scope:ContestationScope; policy_id:str=Field(pattern=r"^policy:[a-z0-9-]{3,64}$"); revision:int=Field(ge=1,le=9999); effective_at:datetime; expires_at:datetime; policy_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.effective_at.tzinfo is None or self.effective_at.utcoffset()!=timezone.utc.utcoffset(self.effective_at) or self.expires_at<=self.effective_at or self.policy_hash!=digest(self.model_dump(exclude={"policy_hash"},mode="python")): raise ValueError("policy_invalid")
  return self
class CaseDeadlineIntent(Frozen):
 case_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); policy_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); deadline_kind:Literal["appeal","response"]; due_at:datetime; intent_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.intent_hash!=digest(self.model_dump(exclude={"intent_hash"},mode="python")): raise ValueError("deadline_hash_mismatch")
  return self
