from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import Field,model_validator
from .customer_contestation_scope_contracts import Frozen,ContestationScope,SyntheticPrincipalBinding,Feature20ContextBinding
from .customer_contestation_policy_contracts import ContestationPolicyVersion
from .customer_contestation_canonical import digest
from .customer_contestation_registry import members
class ContestationSubmission(Frozen):
 scope:ContestationScope; principal:SyntheticPrincipalBinding; policy:ContestationPolicyVersion; feature20_context:Feature20ContextBinding; category:str; affected_artifact_hashes:tuple[str,...]; allegation_fingerprint:str=Field(pattern=r"^[a-f0-9]{64}$"); submitted_at:datetime; idempotency_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); submission_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.category not in {"execution","decision","evidence","service"} or not self.affected_artifact_hashes or self.scope.scope_hash!=self.principal.scope_hash or self.scope.scope_hash!=self.policy.scope.scope_hash or self.feature20_context.scope_hash!=self.scope.scope_hash or self.submission_hash!=digest(self.model_dump(exclude={"submission_hash"},mode="python")): raise ValueError("submission_invalid")
  return self
class ContestationCase(Frozen):
 submission_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); scope_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); case_id:str=Field(pattern=r"^case:[a-z0-9-]{3,64}$"); state:Literal["submitted"]; created_at:datetime; case_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.case_hash!=digest(self.model_dump(exclude={"case_hash"},mode="python")): raise ValueError("case_hash_mismatch")
  return self
class CaseLifecycleEvent(Frozen):
 case_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); sequence:int=Field(ge=1,le=100); from_state:str; to_state:str; predecessor_hash:str|None=None; observed_at:datetime; event_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.event_hash!=digest(self.model_dump(exclude={"event_hash"},mode="python")): raise ValueError("event_hash_mismatch")
  return self
class CaseStateSnapshot(Frozen):
 case_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); state:str; head_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); observed_at:datetime; snapshot_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if self.snapshot_hash!=digest(self.model_dump(exclude={"snapshot_hash"},mode="python")): raise ValueError("snapshot_hash_mismatch")
  return self
