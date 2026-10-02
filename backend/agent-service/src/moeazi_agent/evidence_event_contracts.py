from __future__ import annotations
from dataclasses import dataclass,field
from .evidence_event_canonical import digest,utc
@dataclass(frozen=True)
class EvidenceDelivery:
    scope_hash:str; source_id:str; source_event_id:str; received_at:str; delivery_hash:str=field(init=False)
    def __post_init__(self):
        utc(self.received_at)
        if len(self.source_event_id)>48: raise ValueError("evidence_external_id_invalid")
        object.__setattr__(self,"delivery_hash",digest(self.__dict__))
@dataclass(frozen=True)
class EvidenceEvent:
    scope_hash:str; source_id:str; source_event_id:str; revision:int; event_class:str; event_at:str; source_observed_at:str; received_at:str; body:dict; supersedes_hash:str|None=None; event_hash:str=field(init=False)
    def __post_init__(self):
        for item in (self.event_at,self.source_observed_at,self.received_at): utc(item)
        if self.revision<1 or len(self.source_event_id)>48 or not self.body: raise ValueError("evidence_event_invalid")
        object.__setattr__(self,"event_hash",digest({k:v for k,v in self.__dict__.items() if k!="event_hash"}))
@dataclass(frozen=True)
class EvidenceRelation:
    scope_hash:str; source_hash:str; target_hash:str; relation_kind:str
    @property
    def relation_hash(self): return digest(self.__dict__)
@dataclass(frozen=True)
class QuarantineReceipt:
    scope_hash:str; source_id:str; reason:str
    @property
    def receipt_hash(self): return digest(self.__dict__)
