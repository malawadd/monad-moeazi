"""Checked-in corpus builder. Public callers select IDs; they never submit artifacts."""
from __future__ import annotations
from datetime import timedelta
from importlib.resources import files
from .operator_qualification_canonical import digest, json_loads_strict
from .operator_qualification_registry import registry_hash
from .operator_qualification_scope_contracts import QualificationScope, SyntheticWorkforcePrincipal, OperatorRoleVersion, TrainingModuleVersion, TrainingCompletionReceipt, FrozenQualificationManifest
from .operator_qualification_drill_contracts import DrillScenarioVersion, DrillEvaluationRubric, DrillAttempt, DrillActionReceipt
from .operator_qualification_review_contracts import ReviewerCalibrationReceipt, IndependentReviewAttestation
from .operator_qualification_decision_contracts import QualificationRevocation
from .operator_qualification_evaluator import oracle, decide, consume, grant_state

def _load(): return json_loads_strict(files("moeazi_agent").joinpath("operator_qualification_scenarios.json").read_text("utf-8"))
def scenario_registry(): return [{"id":item["id"],"operation":"replay"} for item in _load()["scenarios"]]
def _hashed(cls, body, key): return cls(**body, **{key:digest(body)})

def evaluate_fixture(scenario_id, mode, now, operator, run_hash):
    source=next((item for item in _load()["scenarios"] if item["id"]==scenario_id),None)
    if not source or mode not in {"observe","enforce"}: raise ValueError("Unknown checked-in operator qualification scenario")
    scope_body={"tenant_fingerprint":"tenant:fixture","scope_id":"scope:qualification","environment":"local"}; scope=_hashed(QualificationScope,scope_body,"scope_hash")
    candidate=_hashed(SyntheticWorkforcePrincipal,{"person_fingerprint":"person:candidate","account_fingerprint":"account:candidate","principal_kind":"human","trust":"synthetic_untrusted"},"principal_hash")
    reviewer_person="person:candidate" if source["kind"] in {"alias_review","self_review"} else "person:reviewer"
    reviewer_kind="human"; reviewer=_hashed(SyntheticWorkforcePrincipal,{"person_fingerprint":reviewer_person,"account_fingerprint":"account:reviewer","principal_kind":reviewer_kind,"trust":"synthetic_untrusted"},"principal_hash")
    role=_hashed(OperatorRoleVersion,{"scope_hash":scope.scope_hash,"role":"safety_change_approver","version":"role:v1","registry_hash":registry_hash()},"role_hash")
    module=_hashed(TrainingModuleVersion,{"scope_hash":scope.scope_hash,"module_id":"module:local-v1","version":"module:v1","role_hash":role.role_hash},"module_hash")
    training=_hashed(TrainingCompletionReceipt,{"scope_hash":scope.scope_hash,"principal_hash":candidate.principal_hash,"module_hash":module.module_hash,"completed_at":now},"receipt_hash")
    family=source.get("family","emergency-stop"); scenario=_hashed(DrillScenarioVersion,{"scope_hash":scope.scope_hash,"scenario_id":family,"version":"drill:v1"},"scenario_hash")
    rubric=_hashed(DrillEvaluationRubric,{"scope_hash":scope.scope_hash,"scenario_hash":scenario.scenario_hash,"version":"rubric:v1"},"rubric_hash")
    attempt_body={"scope_hash":scope.scope_hash,"principal_hash":candidate.principal_hash,"scenario_hash":scenario.scenario_hash,"scenario_id":family,"rubric_hash":rubric.rubric_hash,"nonce":"nonce:fixture","started_at":now,"finished_at":now+timedelta(minutes=5),"action_hashes":[]}
    attempt_seed=digest(attempt_body)
    required=__import__('moeazi_agent.operator_qualification_registry',fromlist=['raw']).raw()["drills"][family]["required"]
    actions=[]; predecessor=None
    for sequence, code in enumerate(required,1):
        action=_hashed(DrillActionReceipt,{"scope_hash":scope.scope_hash,"attempt_hash":attempt_seed,"sequence":sequence,"action_code":code,"adapter":"fake_clock","occurred_at":now+timedelta(minutes=sequence),"predecessor_hash":predecessor},"action_hash"); actions.append(action); predecessor=action.action_hash
    action=actions[0]
    if source["kind"] in {"hard_fail","copied","clock_rollback"}:
        action_body=action.model_dump(exclude={"action_hash"}); action_body["adapter"]="fake_forbidden" if source["kind"] in {"hard_fail","copied"} else "fake_clock"; action_body["occurred_at"]=now-timedelta(minutes=1) if source["kind"]=="clock_rollback" else action_body["occurred_at"]; action=_hashed(DrillActionReceipt,action_body,"action_hash")
        actions[0]=action
    attempt_body["action_hashes"]=sorted(item.action_hash for item in actions); attempt=_hashed(DrillAttempt,attempt_body,"attempt_hash")
    oracle_receipt=oracle(attempt,actions,now)
    calibration=_hashed(ReviewerCalibrationReceipt,{"scope_hash":scope.scope_hash,"rubric_hash":rubric.rubric_hash,"reviewer_person_hashes":sorted([candidate.principal_hash,reviewer.principal_hash]),"case_count":20,"kappa_numerator":7,"kappa_denominator":10,"calibrated_at":now},"calibration_hash")
    review=None if source["kind"] in {"missing_review","training_only"} else _hashed(IndependentReviewAttestation,{"scope_hash":scope.scope_hash,"attempt_hash":attempt.attempt_hash,"oracle_hash":oracle_receipt.oracle_hash,"rubric_hash":rubric.rubric_hash,"calibration_hash":calibration.calibration_hash,"reviewer_principal_hash":reviewer.principal_hash,"candidate_principal_hash":candidate.principal_hash,"reviewer_person_fingerprint":reviewer.person_fingerprint,"candidate_person_fingerprint":candidate.person_fingerprint,"decision":"pass","reviewed_at":now},"review_hash")
    manifest_hashes=sorted([role.role_hash,module.module_hash,training.receipt_hash,scenario.scenario_hash,rubric.rubric_hash,attempt.attempt_hash,oracle_receipt.oracle_hash,calibration.calibration_hash]+([review.review_hash] if review else []))
    manifest=_hashed(FrozenQualificationManifest,{"scope_hash":scope.scope_hash,"registry_hash":registry_hash(),"policy_hash":registry_hash(),"artifact_hashes":manifest_hashes},"manifest_hash")
    decision,grant=decide(scope.scope_hash,candidate,role,training,attempt,oracle_receipt,calibration,review,manifest,now)
    revocations=[]
    consume_now=now
    if source["kind"]=="expired" and grant: consume_now=grant.expires_at+timedelta(milliseconds=1)
    if source["kind"]=="revoked" and grant:
        revoke_body={"scope_hash":scope.scope_hash,"grant_hash":grant.grant_hash,"reason_code":"reason:fixture","revoked_at":now}; revocations=[_hashed(QualificationRevocation,revoke_body,"revocation_hash")]
    operation="product_use" if source["kind"]=="product_use" else "approval"; consumer="safety-change-quorum"
    if source["kind"]=="wrong_role": operation="unknown:operation"
    receipt=consume(scope.scope_hash,grant,role,revocations,consumer,operation,consume_now)
    public={"baselineOutcome":"unavailable","candidateOutcome":decision.outcome,"actualOutcome":decision.outcome,"fixtureQualificationStatus":grant_state(grant,revocations,now=consume_now),"productQualificationStatus":"unknown","productOutcome":"unavailable","authorityEffect":"none","role":role.role,"drillOutcome":oracle_receipt.outcome,"oracleScore":oracle_receipt.score,"reviewOutcome":review.decision if review else "missing","calibrationOutcome":"pass","grantState":grant_state(grant,revocations,now=consume_now),"expiryBand":"expired" if grant and consume_now>=grant.expires_at else "fresh" if grant else "none","consumptionStatus":"fixture_compatible" if receipt.fixture_compatible else "blocked","reasonCodes":receipt.reason_codes or decision.reason_codes,"decisionHash":decision.decision_hash,"receiptHash":receipt.receipt_hash,"registryHash":registry_hash(),"externalAttempts":0,"providerCost":0,"invariantVerdict":"pass","fixtureHash":digest({"scenario":source,"registry":registry_hash()}),"semanticShapeHash":digest(source),"runHash":run_hash,"mode":mode}
    public["_artifacts"]={"scope":scope,"role":role,"module":module,"training":training,"scenario":scenario,"rubric":rubric,"attempt":attempt,"actions":actions,"oracle":oracle_receipt,"calibration":calibration,"review":review,"manifest":manifest,"decision":decision,"grant":grant,"revocations":revocations,"consumption":receipt}
    return public
