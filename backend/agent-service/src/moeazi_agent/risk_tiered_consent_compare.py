from __future__ import annotations
from .risk_tiered_consent_canonical import digest
from .risk_tiered_consent_comparison_contracts import DeltaItem,PostApprovalComparison
from .risk_tiered_consent_registry import field_directions
def compare(packet,baseline:dict[str,int|str],fresh:dict[str,int|str]):
    deltas=[]; reasons=[]
    for key,direction in field_directions().items():
        before,after=baseline.get(key),fresh.get(key)
        if direction=="equal": outcome="same" if before==after else "breach"
        elif direction=="maximum": outcome="neutral" if after==before else "favorable" if after<before else "breach"
        else: outcome="neutral" if after==before else "favorable" if after>before else "breach"
        deltas.append(DeltaItem(field_id=key,direction=direction,outcome=outcome))
        if outcome=="breach": reasons.append("MATERIAL_DELTA")
    outcome="invalidated" if reasons else "within_bounds_favorable" if any(row.outcome=="favorable" for row in deltas) else "within_bounds_neutral"
    body={"packet_hash":packet.packet_hash,"outcome":outcome,"deltas":tuple(deltas),"reason_codes":tuple(sorted(set(reasons))),"dispatch_available":False,"product_available":False}
    return PostApprovalComparison(**body,comparison_hash=digest(body))
