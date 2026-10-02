from dataclasses import dataclass,asdict
from .portability_canonical import digest
from .portability_registry import domain
TERMINAL={"complete","partial","unavailable","omitted","blocked"}
@dataclass(frozen=True)
class NativeCutoff:
 kind:str; value:int|str
 def __post_init__(self):
  if self.kind not in {"convex_revision","timescale_watermark","public_chain_reference"} or not self.value: raise ValueError("portability_cutoff_invalid")
 @property
 def cutoff_hash(self): return digest(asdict(self))
@dataclass(frozen=True)
class DomainExportDefinition:
 domain_id:str
 def __post_init__(self): domain(self.domain_id)
@dataclass(frozen=True)
class DomainExportPlan:
 request_hash:str; policy_hash:str; registry_hash:str; definition:DomainExportDefinition; cutoff:NativeCutoff; serializer_version:str="v1"; schema_version:str="v1"
 def __post_init__(self):
  if domain(self.definition.domain_id)["cutoff"]!=self.cutoff.kind: raise ValueError("portability_cutoff_owner_invalid")
 @property
 def plan_hash(self): return digest(asdict(self))
@dataclass(frozen=True)
class PortableSourceRecord:
 domain_id:str; record_id:str; revision:int; cutoff_position:int; fields:tuple[tuple[str,str|int|bool|None],...]; predecessor_hash:str|None=None; lifecycle_status:str="current"; contestation_label:str="none"
 def __post_init__(self):
  if self.domain_id not in [domain(x)["id"] for x in [self.domain_id]] or not self.record_id or len(self.record_id)>48 or self.revision<1 or len(self.fields)>32: raise ValueError("portability_record_invalid")
  if self.lifecycle_status not in {"current","stale","disputed","held"}: raise ValueError("portability_lifecycle_invalid")
 @property
 def record_hash(self): return digest(asdict(self))
@dataclass(frozen=True)
class OmissionRecord:
 domain_id:str; record_id:str|None; field_classification:str; reason_code:str
 def __post_init__(self):
  domain(self.domain_id)
  if not self.reason_code: raise ValueError("portability_omission_invalid")
 @property
 def omission_hash(self): return digest(asdict(self))
@dataclass(frozen=True)
class DomainExportSnapshotReceipt:
 plan_hash:str; domain_id:str; status:str; observed_count:int; exported_count:int; omitted_count:int; post_cutoff_count:int; file_root:str; omission_root:str
 def __post_init__(self):
  if self.status not in TERMINAL or min(self.observed_count,self.exported_count,self.omitted_count,self.post_cutoff_count)<0: raise ValueError("portability_receipt_invalid")
 @property
 def receipt_hash(self): return digest(asdict(self))
