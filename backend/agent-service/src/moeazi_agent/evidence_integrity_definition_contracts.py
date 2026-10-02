"""Strict, fixture-only identity contracts. These records never carry live evidence."""
from __future__ import annotations
from dataclasses import dataclass,field
from .evidence_integrity_canonical import digest,utc_second

SOURCE_CLASSES=("regulator_primary","protocol_primary","corporate_primary","venue_primary","market_primary","independent_reporting","wire_syndicate","aggregator","verified_social","unverified_social","mirror")
CLAIM_CLASSES=("regulatory_action","protocol_security_incident","corporate_financial_disclosure","venue_status","market_data","social_news_sentiment")
@dataclass(frozen=True)
class IntegrityScope:
 tenant:str; account:str; market:str; claim_class:str; horizon:str; chain_id:int=42161; scope_hash:str=field(init=False)
 def __post_init__(self):
  if not all((self.tenant,self.account,self.market,self.horizon)) or self.claim_class not in CLAIM_CLASSES or self.chain_id!=42161: raise ValueError("evidence_integrity_scope")
  object.__setattr__(self,"scope_hash",digest({"tenant":self.tenant,"account":self.account,"market":self.market,"claimClass":self.claim_class,"horizon":self.horizon,"chain":42161}))
@dataclass(frozen=True)
class SourceEntity:
 id:str; kind:str; status:str="active"
 def __post_init__(self):
  if not self.id or self.kind not in {"regulator","protocol","corporation","venue","market_operator","publisher","social_account","aggregator"} or self.status not in {"active","disputed","revoked","unknown"}: raise ValueError("evidence_integrity_entity")
@dataclass(frozen=True)
class SourceChannel:
 id:str; entity_id:str; source_class:str; state:str="active"
 def __post_init__(self):
  if not self.id or not self.entity_id or self.source_class not in SOURCE_CLASSES or self.state not in {"active","disputed","revoked","unknown"}: raise ValueError("evidence_integrity_channel")
@dataclass(frozen=True)
class ContentObservation:
 id:str; channel_id:str; content_id:str; observed_at:str; expires_at:str; scope:IntegrityScope; lifecycle:str="available"; rights:str="allow"
 def __post_init__(self):
  if not all((self.id,self.channel_id,self.content_id)) or self.lifecycle not in {"available","corrected","superseded","revoked","unknown"} or self.rights not in {"allow","deny","pending","unknown"}: raise ValueError("evidence_integrity_observation")
  utc_second(self.observed_at); utc_second(self.expires_at)
@dataclass(frozen=True)
class SelectedIntegrityContext:
 predecessors:tuple[tuple[str,str],...]; context_hash:str=field(init=False)
 def __post_init__(self):
  if tuple(sorted(self.predecessors))!=self.predecessors or {x[0] for x in self.predecessors}!={"evidence-lifecycle-boundary","external-usage-rights","evidence-event-fabric","claim-disagreement-ledger","specialist-source-value-attribution"}: raise ValueError("evidence_integrity_context")
  object.__setattr__(self,"context_hash",digest({"predecessors":self.predecessors,"trust":"requires_revalidation"}))
