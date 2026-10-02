"""Closed, non-executable records used solely by Feature 31 fixtures."""
from __future__ import annotations
from dataclasses import dataclass,field
from .portfolio_sizing_canonical import digest,utc_second
@dataclass(frozen=True)
class SizingScope:
 tenant:str; account:str; instrument:str; market:str; venue:str; base_unit:str="usd"; chain_id:int=42161; scope_hash:str=field(init=False)
 def __post_init__(self):
  if not all((self.tenant,self.account,self.instrument,self.market,self.venue,self.base_unit)) or self.chain_id!=42161: raise ValueError("portfolio_sizing_scope")
  object.__setattr__(self,"scope_hash",digest({"tenant":self.tenant,"account":self.account,"instrument":self.instrument,"market":self.market,"venue":self.venue,"unit":self.base_unit,"chain":42161}))
@dataclass(frozen=True)
class Feature09SizingBinding:
 run_id:str; request_hash:str; control_hash:str; registry_hash:str; result_hash:str; selected_at:str; trust_status:str="requires_revalidation"; non_authorizing:bool=True
 def __post_init__(self):
  if not all((self.run_id,self.request_hash,self.control_hash,self.registry_hash,self.result_hash)) or self.trust_status!="requires_revalidation" or not self.non_authorizing: raise ValueError("portfolio_sizing_feature09")
  utc_second(self.selected_at)
@dataclass(frozen=True)
class PortfolioSnapshot:
 scope:SizingScope; equity:int; free_collateral:int; gross:int; signed_net:int; cluster:int; observed_at:str; expires_at:str; reconciled:bool=True; status:str="complete"; snapshot_hash:str=field(init=False)
 def __post_init__(self):
  if any(type(x)is not int or x<0 for x in (self.equity,self.free_collateral,self.gross,self.cluster)) or type(self.signed_net)is not int or not self.reconciled or self.status!="complete": raise ValueError("portfolio_sizing_portfolio")
  utc_second(self.observed_at); utc_second(self.expires_at); object.__setattr__(self,"snapshot_hash",digest({"scope":self.scope.scope_hash,"equity":self.equity,"free":self.free_collateral,"gross":self.gross,"net":self.signed_net,"cluster":self.cluster,"observed":self.observed_at,"expires":self.expires_at}))
@dataclass(frozen=True)
class MarketRiskSnapshot:
 scope:SizingScope; mark:int; lot:int; minimum:int; volatility_ppm:int; liquidity:int; cost:int; observed_at:str; expires_at:str; history_complete:bool=True; risk_hash:str=field(init=False)
 def __post_init__(self):
  if any(type(x)is not int or x<0 for x in (self.mark,self.lot,self.minimum,self.volatility_ppm,self.liquidity,self.cost)) or self.mark<=0 or self.lot<=0 or not self.history_complete: raise ValueError("portfolio_sizing_market")
  utc_second(self.observed_at); utc_second(self.expires_at); object.__setattr__(self,"risk_hash",digest({"scope":self.scope.scope_hash,"mark":self.mark,"lot":self.lot,"minimum":self.minimum,"vol":self.volatility_ppm,"liquidity":self.liquidity,"cost":self.cost,"observed":self.observed_at,"expires":self.expires_at}))
@dataclass(frozen=True)
class SizingPolicy:
 version:str; base_risk:int; max_order:int; max_gross:int; max_cluster:int; max_leverage:int; max_volatility_ppm:int; min_net_benefit:int; policy_hash:str=field(init=False)
 def __post_init__(self):
  if not self.version or any(type(x)is not int or x<0 for x in (self.base_risk,self.max_order,self.max_gross,self.max_cluster,self.max_leverage,self.max_volatility_ppm,self.min_net_benefit)) or self.max_leverage<=0: raise ValueError("portfolio_sizing_policy")
  object.__setattr__(self,"policy_hash",digest({"version":self.version,"base":self.base_risk,"order":self.max_order,"gross":self.max_gross,"cluster":self.max_cluster,"leverage":self.max_leverage,"volatility":self.max_volatility_ppm,"benefit":self.min_net_benefit}))
@dataclass(frozen=True)
class TradeIntent:
 direction:str; horizon:str; analysis_hash:str; evidence_hash:str; validity:str; intent_hash:str=field(init=False)
 def __post_init__(self):
  if self.direction not in {"long","short"} or not all((self.horizon,self.analysis_hash,self.evidence_hash,self.validity)): raise ValueError("portfolio_sizing_intent")
  object.__setattr__(self,"intent_hash",digest({"direction":self.direction,"horizon":self.horizon,"analysis":self.analysis_hash,"evidence":self.evidence_hash,"validity":self.validity}))
