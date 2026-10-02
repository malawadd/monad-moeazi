from dataclasses import dataclass,asdict
from .portability_canonical import digest
@dataclass(frozen=True)
class PortabilityStateSnapshot:
 manifest_hash:str; verification_hash:str; grant_hash:str|None; cleanup_hash:str
 @property
 def snapshot_hash(self): return digest(asdict(self))
@dataclass(frozen=True)
class PortabilityRootManifest:
 scope_hash:str; request_hash:str; manifest_hash:str; state_hash:str
 @property
 def root_hash(self): return digest(asdict(self))
