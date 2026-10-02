from dataclasses import dataclass,asdict
from .portability_canonical import digest
@dataclass(frozen=True)
class PortabilityScope:
 operator_test_id:str; tenant_ref:str; account_ref:str; environment:str="local"; chain_id:int=42161
 def __post_init__(self):
  if self.environment!="local" or self.chain_id!=42161: raise ValueError("portability_scope_invalid")
 @property
 def scope_hash(self): return digest(asdict(self))
@dataclass(frozen=True)
class SyntheticStepUpBinding:
 scope_hash:str; status:str="requires_revalidation"; synthetic:bool=True
 @property
 def binding_hash(self): return digest(asdict(self))
@dataclass(frozen=True)
class Feature03ExportContext:
 run_id:str; scope_hash:str; fixture_hash:str; request_hash:str; registry_hash:str; control_hash:str; prerequisite_hash:str; lifecycle_hash:str; status:str="requires_revalidation"; accepted_as_export_authority:bool=False
 def __post_init__(self):
  if self.status!="requires_revalidation" or self.accepted_as_export_authority: raise ValueError("portability_feature03_authority_invalid")
 @property
 def context_hash(self): return digest(asdict(self))
@dataclass(frozen=True)
class UsageRightsStatus:
 status:str="unavailable"
 def __post_init__(self):
  if self.status not in {"unavailable","requires_revalidation"}: raise ValueError("portability_usage_rights_invalid")
