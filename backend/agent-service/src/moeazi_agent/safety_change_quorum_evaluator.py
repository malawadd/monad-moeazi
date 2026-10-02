"""Pure fail-closed evaluator. A fixture success never affects product authority."""
from __future__ import annotations
from datetime import datetime, timedelta
from .safety_change_quorum_canonical import digest
from .safety_change_request_contracts import ChangeRequest
from .safety_change_approval_contracts import QualificationEvidence, HumanApprovalAttestation, ChangeQuorumDecision, AppliedChangeReceipt
from .safety_change_quorum_registry import raw, registry_hash

def classify(before, after, entry: dict) -> str:
    kind=entry["type"]
    if kind=="boolean" and type(before) is bool and type(after) is bool:
        if before==after: return "neutral"
        return "restrictive" if entry["restrict"] == ("false_to_true" if not before else "true_to_false") else "relaxing"
    if kind=="integer" and type(before) is int and type(after) is int and not isinstance(before,bool) and not isinstance(after,bool): return "restrictive" if after<before else "relaxing" if after>before else "neutral"
    if kind=="string_set" and isinstance(before,list) and isinstance(after,list) and before==sorted(set(before)) and after==sorted(set(after)) and all(isinstance(x,str) for x in before+after):
        return "restrictive" if set(after)<set(before) else "relaxing" if set(before)<set(after) else "neutral" if before==after else "mixed"
    if kind=="opaque": return "relaxing" if before!=after else "neutral"
    return "unknown_or_blocked"

def evaluate(request: ChangeRequest, approvals: list[HumanApprovalAttestation], qualifications: dict[str, QualificationEvidence], *, now: datetime, current_state_hash: str | None=None, partial: bool=False) -> dict:
    reasons=[]; directions=[]; policy=raw()
    if request.registry_hash != registry_hash(): reasons.append("registry_hash_drift")
    if request.expires_at < now or request.expires_at > now + timedelta(minutes=60): reasons.append("request_expired")
    if current_state_hash is not None and current_state_hash != request.before_state_hash: reasons.append("state_drift")
    for item in request.diffs:
        target=policy["paths"].get(item.path); direction=classify(item.before,item.after,target) if target else "unknown_or_blocked"
        directions.append(direction)
    if "unknown_or_blocked" in directions or "mixed" in directions: reasons.append("unmapped_or_mixed_change")
    active={x for x in directions if x!="neutral"}
    if len(active)>1: reasons.append("mixed_direction")
    relaxing=active=={"relaxing"}
    people=[]
    if relaxing:
        for approval in approvals:
            qualification=qualifications.get(approval.qualification_hash)
            valid=approval.request_hash==request.request_hash and approval.principal_kind=="human" and approval.workforce_person!=request.requester_person and qualification and qualification.trust=="synthetic_untrusted" and qualification.feature17_status=="unknown" and qualification.state=="active" and approval.role in qualification.roles and now-approval.approved_at<=timedelta(minutes=30) and approval.approved_at<=request.expires_at
            if valid and approval.workforce_person not in people: people.append(approval.workforce_person)
            else: reasons.append("invalid_or_duplicate_attestation")
        people.sort()
        if len(people)<2: reasons.append("insufficient_distinct_synthetic_quorum")
    outcome="would_apply_restriction" if active=={"restrictive"} and not reasons else "would_apply_in_isolated_simulation" if relaxing and not reasons else "no_change" if not active and not reasons else "blocked"
    decision_body={"request_hash":request.request_hash,"outcome":outcome,"counted_people":people,"rejected_reason_codes":sorted(set(reasons)),"product_qualification_status":"unknown"}
    decision=ChangeQuorumDecision(**decision_body,decision_hash=digest(decision_body))
    receipt_body={"request_hash":request.request_hash,"decision_hash":decision.decision_hash,"status":"simulated_partial" if partial and outcome.startswith("would_apply") else "simulated_success" if outcome.startswith("would_apply") else "blocked","reason_codes":decision.rejected_reason_codes}
    receipt=AppliedChangeReceipt(**receipt_body,receipt_hash=digest(receipt_body))
    return {"_request":request,"_approvals":approvals,"_qualifications":list(qualifications.values()),"_decision":decision,"_receipt":receipt,"baselineOutcome":"unavailable","candidateOutcome":outcome,"actualOutcome":outcome,"direction":"relaxing" if relaxing else "restrictive" if active=={"restrictive"} else "blocked","countedApprovals":len(people),"rejectedAttestationCount":len(reasons),"reasonCodes":decision.rejected_reason_codes,"applyStatus":receipt.status,"productQualificationStatus":"unknown","productOutcome":"unavailable","authorityEffect":"none","decisionHash":decision.decision_hash,"receiptHash":receipt.receipt_hash,"registryHash":registry_hash(),"invariantVerdict":"pass"}

def issue_lease(*, quorum: bool, capability: str, now: datetime, expired: bool=False, replay: bool=False, revoke_failure: bool=False) -> dict:
    allowed={"inspect","reconcile","disable","isolate","rotate_service_credential","restore_exact_known_good"}; reasons=[]
    if not quorum: reasons.append("lease_quorum_missing")
    if capability not in allowed: reasons.append("forbidden_capability")
    if expired: reasons.append("lease_expired")
    if replay: reasons.append("nonce_replayed")
    status="paused_fail_closed" if revoke_failure else "blocked" if reasons else "simulated_success"
    return {"leaseState":"paused_fail_closed" if revoke_failure else "expired" if expired else "issued" if not reasons else "blocked","leaseUseStatus":status,"leaseRevocationStatus":"failed_paused" if revoke_failure else "not_required","leaseReasonCodes":sorted(reasons),"leaseHash":digest({"capability":capability,"now":now,"status":status})}
