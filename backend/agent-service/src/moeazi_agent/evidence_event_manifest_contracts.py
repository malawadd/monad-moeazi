from __future__ import annotations
from dataclasses import dataclass
from .evidence_event_canonical import digest
@dataclass(frozen=True)
class MissingSourceState:
 source_id:str; state:str
@dataclass(frozen=True)
class ReplayManifestEvent:
 event_hash:str; sequence:int
@dataclass(frozen=True)
class ReplayManifest:
 scope_hash:str; cutoff:str; events:tuple[ReplayManifestEvent,...]; missing_sources:tuple[MissingSourceState,...]
 @property
 def manifest_hash(self): return digest({"scope":self.scope_hash,"cutoff":self.cutoff,"events":[x.__dict__ for x in self.events],"missing":[x.__dict__ for x in self.missing_sources]})
@dataclass(frozen=True)
class AnalyticalRunManifest:
 replay_manifest_hash:str; tool_set:tuple[str,...]=(); provider_provenance:str="unavailable"
@dataclass(frozen=True)
class FabricStateSnapshot:
 manifest_hash:str; state_hash:str
@dataclass(frozen=True)
class FabricRootManifest:
 scope_hash:str; request_hash:str; manifest_hash:str; state_hash:str
 @property
 def root_hash(self): return digest({"scope":self.scope_hash,"request":self.request_hash,"manifest":self.manifest_hash,"state":self.state_hash})
