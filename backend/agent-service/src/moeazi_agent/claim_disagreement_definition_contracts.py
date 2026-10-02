"""Strict small records; these never model a live SignalReport."""
from __future__ import annotations
from dataclasses import dataclass,field
from .claim_disagreement_canonical import digest,utc_second
TYPES=("trend","liquidity","volatility","liquidation_risk","basis_funding","flow","catalyst","market_integrity","portfolio_exposure","execution_quality")
@dataclass(frozen=True)
class LedgerScope:
 tenant:str; account:str; market:str; chain_id:int=42161; scope_hash:str=field(init=False)
 def __post_init__(self):
  if not all((self.tenant,self.account,self.market)) or self.chain_id!=42161: raise ValueError("ledger_scope")
  object.__setattr__(self,"scope_hash",digest({"tenant":self.tenant,"account":self.account,"market":self.market,"chain":self.chain_id}))
@dataclass(frozen=True)
class EvidenceLink:
 id:str; source_root:str; quality_bps:int; observed_at:str; expires_at:str; evidence_hash:str
 def __post_init__(self):
  if not self.id or not self.source_root or not 0<=self.quality_bps<=10000: raise ValueError("ledger_evidence")
  utc_second(self.observed_at); utc_second(self.expires_at)
@dataclass(frozen=True)
class ClaimMagnitude:
 unit:str|None=None; lower:int|None=None; upper:int|None=None
 def __post_init__(self):
  if self.unit is None and (self.lower is not None or self.upper is not None): raise ValueError("ledger_magnitude")
  if self.unit and (self.lower is None or self.upper is None or self.lower>self.upper): raise ValueError("ledger_magnitude")
@dataclass(frozen=True)
class Claim:
 id:str; scope:LedgerScope; claim_type:str; subject_id:str; horizon:str; polarity:str; role:str; family:str; evidence:tuple[EvidenceLink,...]; falsifier:str|None; expires_at:str; magnitude:ClaimMagnitude=ClaimMagnitude(); critical:bool=False; claim_hash:str=field(init=False)
 def __post_init__(self):
  if self.claim_type not in TYPES or self.polarity not in {"positive","negative","neutral"} or not self.id or not self.subject_id or not self.horizon or not self.role or not self.family: raise ValueError("ledger_claim")
  if len({x.id for x in self.evidence})!=len(self.evidence): raise ValueError("ledger_duplicate_evidence")
  utc_second(self.expires_at); object.__setattr__(self,"claim_hash",digest({"id":self.id,"scope":self.scope.scope_hash,"type":self.claim_type,"subject":self.subject_id,"horizon":self.horizon,"polarity":self.polarity,"role":self.role,"family":self.family,"evidence":[x.id for x in self.evidence],"falsifier":self.falsifier,"expiry":self.expires_at,"magnitude":self.magnitude.__dict__}))
@dataclass(frozen=True)
class ExperimentSubject:
 id:str; tier:str; claims:tuple[Claim,...]; baseline_calls:int; max_calls:int; token_ceiling:int; cost_microusd:int
 def __post_init__(self):
  if self.id not in {"current","ledger_only","conditional_escalation"} or self.tier not in {"Lite","Focus","Pro","Max"} or not 0<=self.baseline_calls<=self.max_calls or min(self.token_ceiling,self.cost_microusd)<0: raise ValueError("ledger_subject")
