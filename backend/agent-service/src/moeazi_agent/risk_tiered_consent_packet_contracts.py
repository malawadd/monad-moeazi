from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import Field
from .risk_tiered_consent_scope_contracts import Frozen,ConsentScope,Hash
class ApprovalPacket(Frozen):
    scope:ConsentScope; tier:Literal["ordinary","elevated","high"]; ceremony:str; issued_at:datetime; expires_at:datetime
    challenge_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); registry_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
    request_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); idempotency_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
    field_coverage:tuple[str,...]; packet_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$")
    fixture_only:Literal[True]=True; product_available:Literal[False]=False; dispatch_available:Literal[False]=False
class ApprovalPacketRender(Frozen):
    packet_hash:Hash=Field(pattern=r"^[a-f0-9]{64}$"); tier:str; ceremony:str; field_count:int; expiry_band:str
    fixture_only:Literal[True]=True; product_available:Literal[False]=False; dispatch_available:Literal[False]=False
