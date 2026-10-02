from dataclasses import dataclass,asdict
from .portability_canonical import digest
@dataclass(frozen=True)
class TransientDeliveryGrant:
 manifest_hash:str; mode:str; nonce_hash:str; state:str="would_issue"; storage:str="fixture_memory"
 @property
 def grant_hash(self): return digest(asdict(self))
@dataclass(frozen=True)
class ExportDeliveryAttempt:
 grant_hash:str; sequence:int; outcome:str
 @property
 def attempt_hash(self): return digest(asdict(self))
@dataclass(frozen=True)
class ExportDeliveryReceipt:
 grant_hash:str; state:str
 @property
 def receipt_hash(self): return digest(asdict(self))
@dataclass(frozen=True)
class ExportCleanupReceipt:
 manifest_hash:str; state:str; residual_file_count:int; residual_bytes:int
 def __post_init__(self):
  if self.residual_file_count<0 or self.residual_bytes<0: raise ValueError("portability_cleanup_invalid")
 @property
 def receipt_hash(self): return digest(asdict(self))
