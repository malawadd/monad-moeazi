from __future__ import annotations
from dataclasses import dataclass
from .evidence_event_canonical import digest
@dataclass(frozen=True)
class SourceWatermarkTransition:
 scope_hash:str; source_id:str; previous_sequence:int; sequence:int; status:str
 def __post_init__(self):
  if self.sequence<self.previous_sequence or self.status not in {"complete","incomplete"}: raise ValueError("evidence_watermark_invalid")
@dataclass(frozen=True)
class MaterialityDecision:
 policy_hash:str; status:str; priority:str
@dataclass(frozen=True)
class TriggerMember:
 trigger_hash:str; event_hash:str; sequence:int
@dataclass(frozen=True)
class TriggerIntent:
 scope_hash:str; event_hashes:tuple[str,...]; priority:str; created_at:str
 @property
 def trigger_hash(self): return digest(self.__dict__)
 @property
 def desired_workflow_identity(self): return digest({"scope":self.scope_hash,"events":self.event_hashes})
@dataclass(frozen=True)
class DispatchObservation:
 trigger_hash:str; status:str="runtime_unavailable"; workflow_started:bool=False; operation_performed:bool=False; external_attempts:int=0; provider_cost:int=0
 def __post_init__(self):
  if self.workflow_started or self.operation_performed or self.external_attempts or self.provider_cost: raise ValueError("evidence_dispatch_boundary")
