from __future__ import annotations
from dataclasses import dataclass,field
from .schedule_sync_canonical import digest,utc
from .schedule_sync_registry import CADENCES,LIFECYCLES
@dataclass(frozen=True)
class DesiredMarketSchedule:
 market_id:str; cadence:str; paused:bool=False
 def __post_init__(self):
  if not self.market_id.isascii() or not self.market_id.replace("-","").isalnum() or self.cadence not in CADENCES: raise ValueError("schedule_sync_market_invalid")
@dataclass(frozen=True)
class DesiredScheduleState:
 scope_hash:str; profile_revision:int; previous_revision:int|None; lifecycle:str; profile_paused:bool; manual_guard:str; lite_mode:str; model_config_revision:int; markets:tuple[DesiredMarketSchedule,...]; desired_hash:str=field(init=False); effective_state:str=field(init=False)
 def __post_init__(self):
  if self.profile_revision<1 or self.lifecycle not in LIFECYCLES or self.manual_guard not in {"on","off","unknown"} or self.lite_mode!="on": raise ValueError("schedule_sync_desired_invalid")
  if self.previous_revision is not None and self.profile_revision!=self.previous_revision+1: raise ValueError("schedule_sync_revision_invalid")
  ids=[x.market_id for x in self.markets]
  if ids!=sorted(ids) or len(ids)!=len(set(ids)): raise ValueError("schedule_sync_market_order_invalid")
  effective="unknown" if self.manual_guard=="unknown" else "paused" if self.manual_guard=="on" or self.profile_paused or self.lifecycle!="active" else "absent" if not self.markets or self.markets[0].cadence=="on_demand" else "scheduled"
  object.__setattr__(self,"effective_state",effective); object.__setattr__(self,"desired_hash",digest({k:v for k,v in self.__dict__.items() if k not in {"desired_hash","effective_state"}}))
@dataclass(frozen=True)
class MaterialChangeDecision:
 previous_hash:str|None; desired_hash:str; material:bool; reason:str; decision_hash:str=field(init=False)
 def __post_init__(self): object.__setattr__(self,"decision_hash",digest({k:v for k,v in self.__dict__.items() if k!="decision_hash"}))
@dataclass(frozen=True)
class ActualScheduleObservation:
 scope_hash:str; revision:int; actual_hash:str; schedule_count:int; observed_at:str
 def __post_init__(self): utc(self.observed_at)
