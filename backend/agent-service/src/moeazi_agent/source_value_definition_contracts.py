"""Strict records deliberately separate from live reports and providers."""
from __future__ import annotations
from dataclasses import dataclass,field
from .source_value_canonical import digest,utc_second
FAMILIES=("exact_venue_price_ohlc","executable_depth","funding_open_interest","liquidation_data","onchain_state_flow","official_protocol_governance","market_integrity","primary_curated_news","secondary_news_syndication","verified_social","unverified_social","portfolio_account_state","execution_reconciliation")
STATUSES=("eligible","degraded","omit","block")
@dataclass(frozen=True)
class SourceValueScope:
 tenant:str; account:str; market:str; role:str; horizon:str; chain_id:int=42161; scope_hash:str=field(init=False)
 def __post_init__(self):
  if not all((self.tenant,self.account,self.market,self.role,self.horizon)) or self.chain_id!=42161: raise ValueError("source_value_scope")
  object.__setattr__(self,"scope_hash",digest({"tenant":self.tenant,"account":self.account,"market":self.market,"role":self.role,"horizon":self.horizon,"chain":42161}))
@dataclass(frozen=True)
class ManifestEvidenceItem:
 id:str; family:str; root_id:str; observed_at:str; expires_at:str; freshness_bps:int; completeness_bps:int; integrity_bps:int; relevance_bps:int; source_lag_seconds:int; ingest_lag_seconds:int; scope:SourceValueScope; lifecycle:str="available"
 def __post_init__(self):
  if not self.id or self.family not in FAMILIES or not self.root_id or self.lifecycle not in {"available","corrected","superseded","unavailable"}: raise ValueError("source_value_item")
  if not all(0<=x<=10000 for x in (self.freshness_bps,self.completeness_bps,self.integrity_bps,self.relevance_bps)) or min(self.source_lag_seconds,self.ingest_lag_seconds)<0: raise ValueError("source_value_quality")
  utc_second(self.observed_at); utc_second(self.expires_at)
@dataclass(frozen=True)
class SpecialistCitationOutput:
 cited_evidence_ids:tuple[str,...]; claim_citations:tuple[tuple[str,tuple[str,...]],...]=()
 def __post_init__(self):
  if len(self.cited_evidence_ids)>64 or len(set(self.cited_evidence_ids))!=len(self.cited_evidence_ids): raise ValueError("source_value_citations")
@dataclass(frozen=True)
class RoleEvidenceContract:
 role:str; horizon:str; required:tuple[str,...]; optional:tuple[str,...]; forbidden:tuple[str,...]; rare_risk_retained:tuple[str,...]; critical:bool; minimum_quality_bps:int=7000; min_roots:int=1
 def __post_init__(self):
  groups=self.required+self.optional+self.forbidden+self.rare_risk_retained
  if not self.role or not self.horizon or any(item not in FAMILIES for item in groups) or len(set(groups))!=len(groups) or not 0<=self.minimum_quality_bps<=10000 or self.min_roots<1: raise ValueError("source_value_contract")
@dataclass(frozen=True)
class SelectedResearchContext:
 evidence_event_run:str; claim_ledger_run:str; context_hash:str
 def __post_init__(self):
  if not all((self.evidence_event_run,self.claim_ledger_run)) or len(self.context_hash)!=64: raise ValueError("source_value_context")
