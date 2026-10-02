"""Pure fail-closed evaluator for checked-in synthetic contestation graphs."""
from dataclasses import dataclass
from .customer_contestation_lifecycle import fold
@dataclass(frozen=True)
class Verdict: boundary:str; reasons:tuple[str,...]; closure_eligible:bool
def evaluate(artifacts):
 reasons=[]; request=artifacts["submission"]; finding=artifacts["finding"]; response=artifacts["response"]; correction=artifacts["correction"]; remedy=artifacts["remedy"]
 try: state,head=fold(artifacts["events"])
 except ValueError: return Verdict("would_block_fixture",("LIFECYCLE_INVALID",),False)
 evidence=artifacts["evidence"]
 if not evidence: reasons.append("EVIDENCE_MISSING")
 elif any(x.lifecycle_status!="current" for x in evidence): reasons.append("EVIDENCE_STALE" if any(x.lifecycle_status=="stale" for x in evidence) else "EVIDENCE_DISPUTED")
 if finding.reviewer_fingerprint==artifacts["investigation"].reviewer_fingerprint and artifacts.get("reviewer_conflict"): reasons.append("REVIEWER_CONFLICT")
 if response.outcome!="delivered": reasons.append("DELIVERY_PENDING")
 if artifacts.get("appeal_pending"): reasons.append("APPEAL_PENDING")
 if correction.status!="recorded": reasons.append("CORRECTION_PENDING")
 if remedy.status in {"uncertain","failed"}: reasons.append("REMEDY_UNCERTAIN")
 elif remedy.status=="simulated_not_executed" and state!="closed": reasons.append("REMEDY_PENDING")
 if reasons: return Verdict("would_hold_fixture",tuple(sorted(set(reasons))),False)
 return Verdict("would_progress_fixture",("CASE_VALID",),state=="closed")
