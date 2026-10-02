from dataclasses import dataclass,asdict
from .portability_canonical import digest
@dataclass(frozen=True)
class DomainPolicy:
 domain_id:str; allow_status:str="allowed"; hold:bool=False; redaction:str="none"
@dataclass(frozen=True)
class PortabilityPolicyVersion:
 policy_id:str; revision:int; domains:tuple[DomainPolicy,...]
 def __post_init__(self):
  if self.revision<1 or len(self.domains)!=10: raise ValueError("portability_policy_invalid")
 @property
 def policy_hash(self): return digest(asdict(self))
