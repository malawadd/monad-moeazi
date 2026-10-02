from dataclasses import dataclass,asdict
from .portability_canonical import digest,normalize_path
@dataclass(frozen=True)
class PortableFileDescriptor:
 domain_id:str; path:str; media_type:str; schema_version:str; serializer_version:str; byte_length:int; record_count:int; cutoff_hash:str; byte_hash:str
 def __post_init__(self):
  normalize_path(self.path)
  if self.byte_length<0 or self.record_count<0: raise ValueError("portability_file_invalid")
 @property
 def descriptor_hash(self): return digest(asdict(self))
@dataclass(frozen=True)
class PortableExportManifest:
 request_hash:str; scope_hash:str; policy_hash:str; registry_hash:str; context_hash:str; receipts:tuple[object,...]; files:tuple[PortableFileDescriptor,...]; omissions:tuple[object,...]; status:str
 def __post_init__(self):
  if len(self.receipts)!=10 or len({x.domain_id for x in self.receipts})!=10 or len({x.path.casefold() for x in self.files})!=len(self.files): raise ValueError("portability_manifest_closure_invalid")
 @property
 def manifest_hash(self): return digest(asdict(self))
@dataclass(frozen=True)
class ExportAssemblyReceipt:
 manifest_hash:str; file_count:int; package_bytes:int; status:str
 @property
 def receipt_hash(self): return digest(asdict(self))
@dataclass(frozen=True)
class ExportVerificationReceipt:
 manifest_hash:str; verified:bool; reason_code:str|None=None
 @property
 def receipt_hash(self): return digest(asdict(self))
