"""Strict non-executable records for Feature 32's fixture-only route research."""
from __future__ import annotations
from dataclasses import dataclass,field
from .execution_quality_canonical import digest,utc_second
SOURCE_CLASSES=("exact_executable","exact_public","indicative","proxy")
@dataclass(frozen=True)
class RoutingScope:
 tenant:str; account:str; instrument:str; market:str; venues:tuple[str,...]; settlement_unit:str="microusd"; chain_id:int=42161; scope_hash:str=field(init=False)
 def __post_init__(self):
  if not all((self.tenant,self.account,self.instrument,self.market,self.settlement_unit)) or self.chain_id!=42161 or not self.venues or tuple(sorted(set(self.venues)))!=self.venues: raise ValueError("execution_quality_scope")
  object.__setattr__(self,"scope_hash",digest({"tenant":self.tenant,"account":self.account,"instrument":self.instrument,"market":self.market,"venues":self.venues,"unit":self.settlement_unit,"chain":42161}))
@dataclass(frozen=True)
class Feature31RouteBinding:
 run_id:str; request_hash:str; control_hash:str; registry_hash:str; fixture_hash:str; result_hash:str; selected_at:str; decision:str; quantity:int; notional:int; trust_status:str="requires_revalidation"; non_authorizing:bool=True
 def __post_init__(self):
  if not all((self.run_id,self.request_hash,self.control_hash,self.registry_hash,self.fixture_hash,self.result_hash)) or self.decision not in {"approve_for_routing","clamped","abstain"} or type(self.quantity)is not int or self.quantity<0 or type(self.notional)is not int or self.notional<0 or self.trust_status!="requires_revalidation" or not self.non_authorizing: raise ValueError("execution_quality_feature31")
  utc_second(self.selected_at)
@dataclass(frozen=True)
class VenueQuoteEvidence:
 venue:str; source_class:str; observed_at:str; expires_at:str; generation:int; bid:int; ask:int; depth:int; fee:int; funding:int; gas:int; healthy:bool; reconciled:bool; continuity:str="complete"; quote_hash:str=field(init=False)
 def __post_init__(self):
  if not self.venue or self.source_class not in SOURCE_CLASSES or type(self.generation)is not int or self.generation<1 or any(type(x)is not int or x<0 for x in (self.bid,self.ask,self.depth,self.fee,self.funding,self.gas)) or self.bid<=0 or self.ask<self.bid or self.continuity not in {"complete","gap","recovery"}: raise ValueError("execution_quality_quote")
  utc_second(self.observed_at); utc_second(self.expires_at); object.__setattr__(self,"quote_hash",digest({"venue":self.venue,"source":self.source_class,"observed":self.observed_at,"expires":self.expires_at,"generation":self.generation,"bid":self.bid,"ask":self.ask,"depth":self.depth,"fee":self.fee,"funding":self.funding,"gas":self.gas,"healthy":self.healthy,"reconciled":self.reconciled,"continuity":self.continuity}))
@dataclass(frozen=True)
class RoutePlan:
 request_hash:str; candidates:tuple[dict,...]; selected_venue:str|None; runner_up:str|None; decision:str; expiry:str; plan_hash:str=field(init=False)
 def __post_init__(self):
  if self.decision not in {"hypothetical_route","abstain_no_synthetic_route"} or not self.request_hash: raise ValueError("execution_quality_plan")
  utc_second(self.expiry); object.__setattr__(self,"plan_hash",digest({"request":self.request_hash,"candidates":self.candidates,"selected":self.selected_venue,"runnerUp":self.runner_up,"decision":self.decision,"expiry":self.expiry,"hypotheticalOnly":True}))
