from __future__ import annotations
from dataclasses import dataclass,field
from .schedule_sync_canonical import digest,utc
from .schedule_sync_registry import TRANSITIONS,MAX_ATTEMPTS
@dataclass(frozen=True)
class ScheduleSyncCommand:
 scope_hash:str; profile_revision:int; desired_hash:str; command_id:str=field(init=False)
 def __post_init__(self): object.__setattr__(self,"command_id","schedule-sync-"+digest(self.__dict__)[:48])
@dataclass(frozen=True)
class CommandTransition:
 command_id:str; sequence:int; previous_status:str; status:str; occurred_at:str; reason:str; transition_hash:str=field(init=False)
 def __post_init__(self):
  if self.sequence<1 or self.status not in TRANSITIONS.get(self.previous_status,()): raise ValueError("schedule_sync_transition_invalid")
  utc(self.occurred_at); object.__setattr__(self,"transition_hash",digest({k:v for k,v in self.__dict__.items() if k!="transition_hash"}))
@dataclass(frozen=True)
class DispatchClaim:
 command_id:str; attempt:int; lease_id:str; claimed_at:str
 def __post_init__(self):
  if not 1<=self.attempt<=MAX_ATTEMPTS: raise ValueError("schedule_sync_attempt_invalid")
  utc(self.claimed_at)
@dataclass(frozen=True)
class ReconciliationAttempt:
 command_id:str; attempt:int; outcome:str; actual_hash:str|None
@dataclass(frozen=True)
class ScheduleMutationObservation:
 command_id:str; applied:bool; operation_performed:bool=False; external_attempts:int=0; provider_cost:int=0
 def __post_init__(self):
  if self.operation_performed or self.external_attempts or self.provider_cost: raise ValueError("schedule_sync_external_effect")
@dataclass(frozen=True)
class ScheduleSyncAcknowledgement:
 command_id:str; desired_hash:str; actual_hash:str; acknowledged_at:str
 def __post_init__(self): utc(self.acknowledged_at)
