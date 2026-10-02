from __future__ import annotations
from dataclasses import dataclass
from .schedule_sync_canonical import digest
@dataclass(frozen=True)
class ScheduleFixtureScope:
 operator_test_id:str; synthetic_tenant_ref:str; synthetic_account_ref:str; synthetic_profile_ref:str; chain_id:int=42161
 def __post_init__(self):
  if self.chain_id!=42161 or not all(isinstance(x,str) and 2<=len(x)<=64 for x in self.__dict__.values() if isinstance(x,str)): raise ValueError("schedule_sync_scope_invalid")
 @property
 def scope_hash(self): return digest(self.__dict__)
@dataclass(frozen=True)
class RuntimeCeilings:
 manual_guard:str="on"; lite_mode:str="on"; live_execution:bool=False; mainnet_venue_setup:bool=False; external_network:bool=False
 def __post_init__(self):
  if self.lite_mode!="on" or self.manual_guard not in {"on","off","unknown"} or self.live_execution or self.mainnet_venue_setup or self.external_network: raise ValueError("schedule_sync_ceiling_invalid")
@dataclass(frozen=True)
class ScheduleSyncRunBinding:
 scope:ScheduleFixtureScope; repository_sha:str; registry_hash:str; control_hash:str; request_hash:str
 @property
 def binding_hash(self): return digest({"scope":self.scope.scope_hash,"repository":self.repository_sha,"registry":self.registry_hash,"control":self.control_hash,"request":self.request_hash})
