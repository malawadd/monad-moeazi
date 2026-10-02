"""Typed local quality, freshness, and materiality policy values."""
from __future__ import annotations
from dataclasses import dataclass,field
from .evidence_event_canonical import digest
from .evidence_event_registry import QUALITY
@dataclass(frozen=True)
class QualityDimension:
 name:str; status:str; reasons:tuple[str,...]=()
 def __post_init__(self):
  if self.name not in QUALITY or self.status not in {"pass","degraded","fail","not_applicable"} or tuple(sorted(set(self.reasons)))!=self.reasons: raise ValueError("evidence_quality_invalid")
@dataclass(frozen=True)
class EvidenceQuality:
 event_hash:str; dimensions:tuple[QualityDimension,...]
 @property
 def quality_hash(self): return digest({"event":self.event_hash,"dimensions":[x.__dict__ for x in self.dimensions]})
@dataclass(frozen=True)
class FreshnessPolicy:
 source_family:str; role:str; market_class:str; horizon:str; action:str; maximum_age_seconds:int=900
 def __post_init__(self):
  if self.action not in {"exclude","degrade_role","block_role","block_proposal"} or self.maximum_age_seconds<0: raise ValueError("evidence_freshness_policy_invalid")
 @property
 def policy_hash(self): return digest(self.__dict__)
@dataclass(frozen=True)
class FreshnessDecision:
 policy_hash:str; status:str; reasons:tuple[str,...]=()
@dataclass(frozen=True)
class MaterialityPolicy:
 policy_id:str; enter_numerator:int; enter_denominator:int=1; priority:str="normal"
 def __post_init__(self):
  if self.enter_denominator<=0 or self.priority not in {"normal","high"}: raise ValueError("evidence_materiality_policy_invalid")
 @property
 def policy_hash(self): return digest(self.__dict__)
