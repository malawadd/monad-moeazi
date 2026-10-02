"""Safe result projections; no record grants authority."""
from __future__ import annotations
from dataclasses import dataclass,field
from .source_value_canonical import digest
@dataclass(frozen=True)
class CitationResolution:
 supplied:tuple[str,...]; cited:tuple[str,...]; supporting:tuple[str,...]; invalid:tuple[str,...]; resolution_hash:str=field(init=False)
 def __post_init__(self):
  if len(set(self.supplied))!=len(self.supplied) or len(set(self.cited))!=len(self.cited): raise ValueError("source_value_resolution")
  object.__setattr__(self,"resolution_hash",digest({"supplied":self.supplied,"cited":self.cited,"supporting":self.supporting,"invalid":self.invalid}))
@dataclass(frozen=True)
class RoleEvidenceStatus:
 status:str; reasons:tuple[str,...]; independent_roots:int; status_hash:str=field(init=False)
 def __post_init__(self):
  if self.status not in {"eligible","degraded","omit","block"} or self.independent_roots<0: raise ValueError("source_value_status")
  object.__setattr__(self,"status_hash",digest({"status":self.status,"reasons":self.reasons,"roots":self.independent_roots}))
@dataclass(frozen=True)
class FamilyContributionEstimate:
 family:str; objective:str; estimate_bps:int; lower_bps:int; upper_bps:int; effective_pairs:int; state:str
 def __post_init__(self):
  if self.lower_bps>self.upper_bps or self.effective_pairs<0 or self.state not in {"estimated","inconclusive","expired"}: raise ValueError("source_value_estimate")
@dataclass(frozen=True)
class ContractCandidateDecision:
 decision:str; research_status:str="hold"
 def __post_init__(self):
  if self.decision not in {"retain","shadow_candidate","inconclusive"} or self.research_status!="hold": raise ValueError("source_value_candidate")
