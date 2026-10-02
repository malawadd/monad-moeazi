"""Strict frozen records for Feature 33's non-authorizing simulator."""
from __future__ import annotations
from dataclasses import dataclass,field
from .shadow_tca_canonical import digest,utc_second
@dataclass(frozen=True)
class ShadowTcaScope:
 tenant:str; account:str; market:str; venue:str; chain_id:int=42161; scope_hash:str=field(init=False)
 def __post_init__(self):
  if not all((self.tenant,self.account,self.market,self.venue)) or self.chain_id!=42161: raise ValueError("shadow_tca_scope")
  object.__setattr__(self,"scope_hash",digest({"tenant":self.tenant,"account":self.account,"market":self.market,"venue":self.venue,"chain":42161}))
@dataclass(frozen=True)
class Feature32ShadowBinding:
 run_id:str; request_hash:str; control_hash:str; registry_hash:str; fixture_hash:str; result_hash:str; selected_at:str; decision:str; trust_status:str="requires_revalidation"; non_authorizing:bool=True
 def __post_init__(self):
  if not all((self.run_id,self.request_hash,self.control_hash,self.registry_hash,self.fixture_hash,self.result_hash)) or self.decision not in {"hypothetical_route","abstain_no_synthetic_route"} or self.trust_status!="requires_revalidation" or not self.non_authorizing: raise ValueError("shadow_tca_feature32")
  utc_second(self.selected_at)
@dataclass(frozen=True)
class MarketStateSnapshot:
 semantic_family:str; observed_at:str; expires_at:str; generation:int; bid:int; ask:int; available_quantity:int; fee:int; funding:int; gas:int; observability:str; snapshot_hash:str=field(init=False)
 def __post_init__(self):
  if self.semantic_family not in {"clob_perpetual","arbitrum_amm"} or self.observability not in {"quote_at_timestamp","sequence_complete_replay","depth_approximation","proxy_indicative"} or type(self.generation)is not int or self.generation<1 or any(type(x)is not int or x<0 for x in (self.bid,self.ask,self.available_quantity,self.fee,self.funding,self.gas)) or self.bid<=0 or self.ask<self.bid: raise ValueError("shadow_tca_snapshot")
  utc_second(self.observed_at);utc_second(self.expires_at);object.__setattr__(self,"snapshot_hash",digest({"family":self.semantic_family,"observed":self.observed_at,"expires":self.expires_at,"generation":self.generation,"bid":self.bid,"ask":self.ask,"quantity":self.available_quantity,"fee":self.fee,"funding":self.funding,"gas":self.gas,"observability":self.observability}))
@dataclass(frozen=True)
class ShadowExecutionRequest:
 scope:ShadowTcaScope; binding:Feature32ShadowBinding; side:str; quantity:int; order_type:str; tif:str; limit_price:int|None; decision_at:str; arrival_at:str; deadline_at:str; idempotency_key:str; request_hash:str=field(init=False)
 def __post_init__(self):
  if self.side not in {"buy","sell"} or self.order_type not in {"market","limit"} or self.tif not in {"IOC","GTC","ALO","TWAP"} or type(self.quantity)is not int or self.quantity<=0 or (self.order_type=="limit" and (type(self.limit_price)is not int or self.limit_price<=0)) or not self.idempotency_key: raise ValueError("shadow_tca_request")
  for value in (self.decision_at,self.arrival_at,self.deadline_at): utc_second(value)
  if self.arrival_at<self.decision_at or self.deadline_at<self.arrival_at: raise ValueError("shadow_tca_ordering")
  object.__setattr__(self,"request_hash",digest({"scope":self.scope.scope_hash,"binding":self.binding.run_id,"side":self.side,"quantity":self.quantity,"orderType":self.order_type,"tif":self.tif,"limit":self.limit_price,"decision":self.decision_at,"arrival":self.arrival_at,"deadline":self.deadline_at,"key":self.idempotency_key}))
