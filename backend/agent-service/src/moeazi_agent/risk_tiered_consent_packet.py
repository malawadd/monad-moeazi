from __future__ import annotations
from datetime import timedelta
from .risk_tiered_consent_canonical import digest,sorted_unique
from .risk_tiered_consent_packet_contracts import ApprovalPacket,ApprovalPacketRender
from .risk_tiered_consent_registry import field_directions
def build(scope,request,assessment,issued_at):
    if assessment.issuance!="issued" or request.mode!="Approval": raise ValueError("packet_issuance_blocked")
    fields=tuple(sorted(field_directions()))
    challenge=digest({"scope":scope.scope_hash,"request":request.request_hash,"issued":issued_at})
    body={"scope":scope,"tier":assessment.tier,"ceremony":assessment.ceremony,"issued_at":issued_at,"expires_at":min(assessment.expires_at,issued_at+timedelta(seconds={"ordinary":300,"elevated":120,"high":60}[assessment.tier])),"challenge_hash":challenge,"registry_hash":assessment.registry_hash,"request_hash":request.request_hash,"idempotency_hash":request.idempotency_hash,"field_coverage":sorted_unique(fields),"fixture_only":True,"product_available":False,"dispatch_available":False}
    return ApprovalPacket(**body,packet_hash=digest(body))
def render(packet,now):
    seconds=max(0,int((packet.expires_at-now).total_seconds())); band="expired" if seconds==0 else "under_minute" if seconds<60 else "active"
    return ApprovalPacketRender(packet_hash=packet.packet_hash,tier=packet.tier,ceremony=packet.ceremony,field_count=len(packet.field_coverage),expiry_band=band)
