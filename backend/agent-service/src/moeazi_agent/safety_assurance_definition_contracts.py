"""Closed definition records; all content comes from checked-in corpus resources."""
from __future__ import annotations
from dataclasses import dataclass,field
from .safety_assurance_canonical import digest
@dataclass(frozen=True)
class Definition:
 id:str; version:str="v1"; reason_code:str="FIXTURE_ONLY"; canonical_hash:str=field(init=False)
 def __post_init__(self):
  if not self.id.replace("-","").isalnum(): raise ValueError("assurance_id_invalid")
  object.__setattr__(self,"canonical_hash",digest({"id":self.id,"version":self.version,"reason":self.reason_code}))
@dataclass(frozen=True)
class SafetyClaim(Definition): owner:str="agent-service"; critical:bool=True; oracle_id:str="canonical_identity"
@dataclass(frozen=True)
class InvariantSpec(Definition): claim_id:str="canonical-identity"
@dataclass(frozen=True)
class ScenarioPack(Definition): case_ids:tuple[str,...]=()
@dataclass(frozen=True)
class ScenarioCase(Definition): pack_id:str="pack-canonical"; claim_id:str="canonical-identity"; expected:str="supported"
@dataclass(frozen=True)
class FaultMutation(Definition): case_id:str="case-01"; category:str="semantic"; disposition:str="non_equivalent"
@dataclass(frozen=True)
class MutationAdjudication(Definition): mutation_id:str=""; reviewer_id:str="synthetic-reviewer"; disposition:str="equivalent"
@dataclass(frozen=True)
class SourceBinding(Definition): resource:str=""; source_hash:str=""
