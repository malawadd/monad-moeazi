"""Pure fail-closed qualification folds for checked-in synthetic artifacts only."""
from __future__ import annotations
from datetime import datetime, timedelta
from .operator_qualification_canonical import digest
from .operator_qualification_registry import raw, registry_hash
from .operator_qualification_scope_contracts import FrozenQualificationManifest, OperatorRoleVersion, SyntheticWorkforcePrincipal, TrainingCompletionReceipt
from .operator_qualification_drill_contracts import DrillAttempt, DrillActionReceipt, MachineOracleReceipt
from .operator_qualification_review_contracts import IndependentReviewAttestation, ReviewerCalibrationReceipt
from .operator_qualification_decision_contracts import OperatorQualificationDecision, OperatorQualificationGrant, QualificationConsumptionReceipt, QualificationRevocation

def oracle(attempt: DrillAttempt, actions: list[DrillActionReceipt], now: datetime) -> MachineOracleReceipt:
    reasons=[]; policy=raw()
    spec=policy["drills"].get(attempt.scenario_id)
    if not spec: reasons.append("scenario_not_registered")
    if attempt.finished_at < attempt.started_at or attempt.finished_at-attempt.started_at > timedelta(minutes=policy["limits"]["attemptMinutes"]): reasons.append("attempt_duration_invalid")
    ordered=sorted(actions,key=lambda item:item.sequence)
    if [item.sequence for item in ordered] != list(range(1,len(ordered)+1)): reasons.append("action_sequence_invalid")
    if any(item.adapter not in policy["fakeAdapters"] for item in actions): reasons.append("adapter_not_allowed")
    if any(item.occurred_at < attempt.started_at or item.occurred_at > attempt.finished_at for item in actions): reasons.append("action_time_invalid")
    codes=[item.action_code for item in ordered]
    if spec:
        required=spec["required"]
        if codes[:len(required)] != required: reasons.append("required_action_order_invalid")
        if any(code in spec["forbidden"] for code in codes): reasons.append("forbidden_action")
        if any(code not in codes for code in spec["hard"]): reasons.append("hard_safety_step_missing")
        if any((item.occurred_at-attempt.started_at).total_seconds()>spec["deadline"] for item in ordered): reasons.append("deadline_exceeded")
    score=policy["limits"]["scoreMax"] if not reasons else max(0, policy["limits"]["scoreMax"]-policy["rubrics"]["rubric:v1"]["weights"]["required"])
    outcome="pass" if score>=policy["limits"]["passScore"] else "fail"
    body={"scope_hash":attempt.scope_hash,"attempt_hash":attempt.attempt_hash,"rubric_hash":attempt.rubric_hash,"score":score,"outcome":outcome,"reason_codes":sorted(reasons)}
    return MachineOracleReceipt(**body,oracle_hash=digest(body))

def decide(scope_hash: str, candidate: SyntheticWorkforcePrincipal, role: OperatorRoleVersion,
           training: TrainingCompletionReceipt, attempt: DrillAttempt, oracle_receipt: MachineOracleReceipt,
           calibration: ReviewerCalibrationReceipt | None, review: IndependentReviewAttestation | None,
           manifest: FrozenQualificationManifest, now: datetime) -> tuple[OperatorQualificationDecision, OperatorQualificationGrant | None]:
    reasons=[]; policy=raw()
    if manifest.registry_hash != registry_hash() or manifest.scope_hash != scope_hash or role.registry_hash != registry_hash(): reasons.append("registry_or_scope_drift")
    if candidate.principal_kind != "human" or candidate.trust != "synthetic_untrusted": reasons.append("candidate_not_synthetic_human")
    if any(x.scope_hash != scope_hash for x in (role,training,attempt,oracle_receipt)): reasons.append("cross_scope_artifact")
    if training.principal_hash != candidate.principal_hash: reasons.append("training_candidate_mismatch")
    if attempt.principal_hash != candidate.principal_hash or oracle_receipt.outcome != "pass": reasons.append("drill_not_passed")
    if not calibration or not review: reasons.append("independent_review_missing")
    else:
        if calibration.scope_hash != scope_hash or calibration.rubric_hash != attempt.rubric_hash or review.scope_hash != scope_hash: reasons.append("review_version_or_scope_drift")
        if now-calibration.calibrated_at > timedelta(days=policy["limits"]["calibrationDays"]): reasons.append("calibration_stale")
        if review.reviewer_principal_hash == candidate.principal_hash or review.candidate_principal_hash != candidate.principal_hash or review.reviewer_person_fingerprint == candidate.person_fingerprint: reasons.append("reviewer_not_independent")
        if review.attempt_hash != attempt.attempt_hash or review.oracle_hash != oracle_receipt.oracle_hash or review.rubric_hash != attempt.rubric_hash or review.calibration_hash != calibration.calibration_hash or review.decision != "pass": reasons.append("review_mismatch")
    outcome="granted_fixture" if not reasons else "incomplete" if "independent_review_missing" in reasons else "blocked"
    body={"scope_hash":scope_hash,"principal_hash":candidate.principal_hash,"role_hash":role.role_hash,"manifest_hash":manifest.manifest_hash,"outcome":outcome,"reason_codes":sorted(set(reasons))}
    decision=OperatorQualificationDecision(**body,decision_hash=digest(body)); grant=None
    if outcome=="granted_fixture":
        grant_body={"scope_hash":scope_hash,"principal_hash":candidate.principal_hash,"role_hash":role.role_hash,"decision_hash":decision.decision_hash,"calibration_hash":calibration.calibration_hash,"issued_at":now,"expires_at":now+timedelta(days=policy["limits"]["grantDays"]),"state":"active_fixture"}
        grant=OperatorQualificationGrant(**grant_body,grant_hash=digest(grant_body))
    return decision,grant

def grant_state(grant: OperatorQualificationGrant | None, revocations: list[QualificationRevocation], *, now: datetime, registry_ok: bool=True) -> str:
    if not grant: return "unknown"
    if not registry_ok: return "drifted"
    if any(item.grant_hash==grant.grant_hash and item.revoked_at<=now for item in revocations): return "revoked"
    if grant.expires_at<=now: return "expired"
    return "active_fixture"

def consume(scope_hash: str, grant: OperatorQualificationGrant | None, role: OperatorRoleVersion,
            revocations: list[QualificationRevocation], consumer_feature: str, operation: str, now: datetime) -> QualificationConsumptionReceipt:
    policy=raw(); state=grant_state(grant,revocations,now=now); reasons=[]
    required_role=policy["consumers"].get(consumer_feature,{}).get(operation)
    if not required_role: reasons.append("consumer_operation_unmapped")
    if not grant or grant.role_hash != role.role_hash or role.role != required_role: reasons.append("role_mismatch")
    if grant and (grant.scope_hash != scope_hash or role.scope_hash != scope_hash): reasons.append("scope_mismatch")
    if state != "active_fixture": reasons.append(f"grant_{state}")
    body={"scope_hash":scope_hash,"grant_hash":grant.grant_hash if grant else None,"consumer_feature":consumer_feature,"operation":operation,"effective_state":state,"fixture_compatible":not reasons,"accepted_for_product":False,"reason_codes":sorted(set(reasons))}
    return QualificationConsumptionReceipt(**body,receipt_hash=digest(body))
