from __future__ import annotations
from dataclasses import dataclass,field
from .schedule_sync_canonical import digest
@dataclass(frozen=True)
class DeadLetterReceipt:
 command_id:str; reason:str
@dataclass(frozen=True)
class OperatorVisibilityReceipt:
 command_id:str; reason:str
@dataclass(frozen=True)
class ScheduleSyncProjection:
 material_command_count:int; suppressed_command_count:int; desired_schedule_count:int; actual_schedule_count:int; retry_count:int; superseded_count:int; dead_letter_count:int; actual_hash:str; root_hash:str
 def safe(self): return {"baseline":"synthetic_local","candidate":"schedule-sync-outbox","materialCommandCount":self.material_command_count,"suppressedCommandCount":self.suppressed_command_count,"desiredScheduleCount":self.desired_schedule_count,"actualScheduleCount":self.actual_schedule_count,"retryCount":self.retry_count,"supersededCount":self.superseded_count,"deadLetterCount":self.dead_letter_count,"driftVerdict":"clear","staleOverwriteVerdict":"clear","actualHash":self.actual_hash[:12],"rootHash":self.root_hash[:12],"fixtureOnly":True,"productOutcome":"unavailable","runtimeDispatch":"unavailable","workflowStarted":False,"analysisDispatched":False,"operationPerformed":False,"authorityEffect":"none","externalAttempts":0,"providerCost":0,"reasons":[]}
@dataclass(frozen=True)
class ScheduleSyncRoot:
 scope_hash:str; request_hash:str; desired_hash:str; actual_hash:str; root_hash:str=field(init=False)
 def __post_init__(self): object.__setattr__(self,"root_hash",digest({k:v for k,v in self.__dict__.items() if k!="root_hash"}))
class ScheduleSyncConflict(RuntimeError): pass
