"""Pure, monotone fixture tier reduction; it does not look up owners or execute anything."""
from __future__ import annotations
from datetime import datetime,timedelta
from .risk_tiered_consent_assessment_contracts import ApprovalRiskAssessment
from .risk_tiered_consent_canonical import digest
from .risk_tiered_consent_registry import registry_hash,tier_cap,source_ids
from .risk_tiered_consent_source_contracts import ApprovalInputManifest
ORDER={"ordinary":0,"elevated":1,"high":2}
def assess(manifest:ApprovalInputManifest,now:datetime,context_reason:str|None=None)->ApprovalRiskAssessment:
    grouped={}
    reasons=[]; triggers=[]; coverage="complete"; expiries=[]
    for row in manifest.sources: grouped.setdefault(row.source_id,[]).append(row)
    current=[]
    for source_id in source_ids():
        chain=sorted(grouped.get(source_id,[]),key=lambda row:row.sequence)
        if not chain: reasons.append("MISSING_SOURCE"); coverage="partial"; continue
        if len({row.sequence for row in chain})!=len(chain) or chain[0].sequence!=1 or chain[0].predecessor_hash is not None or any(row.predecessor_hash!=before.source_hash or row.sequence!=before.sequence+1 for before,row in zip(chain,chain[1:])):
            reasons.append("SOURCE_CHAIN_CONFLICT"); coverage="conflict"; continue
        row=chain[-1]; current.append(row); expiries.append(row.expires_at)
        if row.scope!=manifest.scope or row.status!="current" or row.provenance!="local_fixture_untrusted" or row.expires_at<=now:
            reasons.append(f"{source_id.upper()}_SOURCE_BLOCKED" if source_id in {"policy","emergency"} else "BLOCKED_SOURCE"); coverage="partial"
    if context_reason:
        reasons.append(context_reason); coverage="partial"
    tier="ordinary"
    for row in current:
        if row.utilization_bps>=7000 or row.source_id=="uncertainty" and row.status!="current": tier=max(tier,"elevated",key=ORDER.get); triggers.append("ELEVATED_TRIGGER")
        if row.utilization_bps>=9000 or row.novel or row.near_liquidation or row.irreversible or row.privacy_downgrade: tier="high"; triggers.append("HIGH_TRIGGER")
    if coverage!="complete": tier="high"
    ceremony={"ordinary":"owner_proof","elevated":"fresh_auth","high":"deliberate_review"}[tier]
    expiry=min(min(expiries),now+timedelta(seconds=tier_cap(tier))) if expiries else now
    body={"tier":tier,"ceremony":ceremony,"issuance":"issued" if coverage=="complete" else "blocked","triggers":tuple(sorted(set(triggers))),"reason_codes":tuple(sorted(set(reasons))),"source_coverage":coverage,"registry_hash":registry_hash(),"assessed_at":now,"expires_at":expiry,"non_authorizing":True,"product_status":"unavailable","authority_effect":"none"}
    return ApprovalRiskAssessment(**body,assessment_hash=digest(body))
def assert_monotone(before,after):
    if ORDER[after.tier]<ORDER[before.tier]: raise AssertionError("tier_lowered")
