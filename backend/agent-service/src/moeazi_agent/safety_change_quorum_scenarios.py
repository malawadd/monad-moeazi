"""Checked-in bounded inputs; callers cannot supply identities or mutations."""
from __future__ import annotations
from datetime import timedelta
from importlib.resources import files
from .safety_change_quorum_canonical import digest, json_loads_strict
from .safety_change_scope_contracts import SafetyScope
from .safety_change_request_contracts import ChangeRequest
from .safety_change_approval_contracts import QualificationEvidence, HumanApprovalAttestation
from .safety_change_quorum_evaluator import evaluate, issue_lease
from .safety_change_quorum_registry import registry_hash

def _load(): return json_loads_strict(files("moeazi_agent").joinpath("safety_change_quorum_scenarios.json").read_text("utf-8"))
def scenario_registry(): return [{"id":x["id"],"operation":"replay"} for x in _load()["scenarios"]]
def evaluate_fixture(scenario_id, mode, now, operator, run_hash):
    source=next((x for x in _load()["scenarios"] if x["id"]==scenario_id),None)
    if not source or mode not in {"observe","enforce"}: raise ValueError("Unknown checked-in safety change quorum scenario")
    scope_body={"tenant_fingerprint":"tenant:fixture","scope_id":"scope:fixture","environment":"local"}; scope=SafetyScope(**scope_body,scope_hash=digest(scope_body))
    path="runtime.manual_guard.enabled"; before=True; after=False
    if source["kind"] in {"restrict","partial"}: before=False; after=True
    if source["kind"]=="mixed": diffs=[{"path":path,"before":True,"after":False},{"path":"risk.max_notional_native","before":10,"after":5}]
    elif source["kind"]=="unmapped": diffs=[{"path":"unknown.privileged.path","before":True,"after":False}]
    else: diffs=[{"path":path,"before":before,"after":after}]
    base={"scope":scope,"requester_person":"person:requester","requester_account":"account:requester","diffs":diffs,"policy_hash":digest({"policy":"local-v1"}),"registry_hash":registry_hash(),"repository_sha":"0000000000000000000000000000000000000000","before_state_hash":digest({"before":scenario_id}),"after_state_hash":digest({"after":scenario_id}),"evidence_hashes":[digest({"evidence":scenario_id})],"test_hashes":[digest({"test":scenario_id})],"expires_at":now+timedelta(minutes=20),"idempotency_key":"key:fixture"}
    request=ChangeRequest(**base,request_hash=digest(base))
    approvals=[]; qualifications={}
    for index, person in enumerate(["person:one","person:two"]):
        if source["kind"]=="duplicate": person="person:one"
        if source["kind"]=="self": person="person:requester"
        state="stale" if source["kind"]=="stale" else "active"; trust="synthetic_untrusted"
        qb={"workforce_person":person,"trust":trust,"feature17_status":"unknown","roles":["safety_operator"],"state":state,"observed_at":now}; qualification=QualificationEvidence(**qb,evidence_hash=digest(qb)); qualifications[qualification.evidence_hash]=qualification
        ab={"request_hash":request.request_hash,"workforce_person":person,"account_fingerprint":f"account:{index}","principal_kind":"service" if source["kind"]=="service" else "human","role":"safety_operator","qualification_hash":qualification.evidence_hash,"approved_at":now}; approvals.append(HumanApprovalAttestation(**ab,approval_hash=digest(ab)))
    result=evaluate(request,approvals,qualifications,now=now,current_state_hash=digest({"wrong":scenario_id}) if source["kind"]=="drift" else request.before_state_hash,partial=source["kind"]=="partial")
    if source["kind"].startswith("lease") or source["kind"]=="lease": result.update(issue_lease(quorum=source["kind"]=="lease",capability="trade" if source["kind"]=="lease_forbidden" else "inspect",now=now,expired=source["kind"]=="lease_expired",replay=source["kind"]=="lease_replay",revoke_failure=source["kind"]=="lease_revoke_failure"))
    else: result.update({"leaseState":"not_issued","leaseUseStatus":"not_attempted","leaseRevocationStatus":"not_required","leaseReasonCodes":[],"leaseHash":digest({"lease":"none"})})
    result.update({"fixtureHash":digest({"scenario":source,"registry":registry_hash()}),"semanticShapeHash":digest(source),"runHash":run_hash,"mode":mode})
    return result
