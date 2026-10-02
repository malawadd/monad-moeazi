"""Closed 96-case corpus. Expectations are checked-in data, never evaluator output."""
from __future__ import annotations
from datetime import datetime,timedelta,timezone
from functools import lru_cache
from importlib.resources import files
from .customer_contestation_canonical import digest,json_loads_strict
from .customer_contestation_scope_contracts import ContestationScope,SyntheticPrincipalBinding,Feature20ContextBinding
from .customer_contestation_policy_contracts import ContestationPolicyVersion
from .customer_contestation_case_contracts import ContestationSubmission,ContestationCase,CaseLifecycleEvent
from .customer_contestation_investigation_contracts import InvestigationScope,InvestigationEvidenceReference,InvestigationActionReceipt,CaseFinding,DomainCorrectionIntent,DomainCorrectionReceipt
from .customer_contestation_appeal_contracts import CustomerResponse
from .customer_contestation_remedy_contracts import RemedyProposal,RemedyAuthorization,RemedyExecutionReceipt,CaseClosureReceipt
from .customer_contestation_bundle_contracts import ContestationBundleManifest
from .customer_contestation_evaluator import evaluate
from .customer_contestation_projection import safe_projection
from .customer_contestation_registry import registry_hash
NOW=datetime(2026,9,7,tzinfo=timezone.utc)
def _made(cls,body,field): return cls(**body,**{field:digest(body)})
def _scope():
 body={"tenant_fingerprint":"tenant:fixture","operator_fingerprint":"operator:fixture","account_fingerprint":"account:fixture","customer_fingerprint":"customer:fixture","chain_id":42161}; return _made(ContestationScope,body,"scope_hash")
@lru_cache(maxsize=1)
def scenario_registry():
 rows=[]
 for i in range(1,9): rows.extend(json_loads_strict(files("moeazi_agent").joinpath(f"customer_contestation_scenarios_{i:02d}.json").read_text("utf-8"))["scenarios"])
 if len(rows)!=96 or len({x["id"] for x in rows})!=96: raise ValueError("contestation_scenario_closure_invalid")
 return tuple(rows)
@lru_cache(maxsize=1)
def expectations():
 out={}
 for i in range(1,9): out.update(json_loads_strict(files("moeazi_agent").joinpath(f"customer_contestation_expectations_{i:02d}.json").read_text("utf-8"))["expected"])
 if set(out)!={x["id"] for x in scenario_registry()}: raise ValueError("contestation_expectations_closure_invalid")
 return out
def build_artifacts(row,now,run_hash):
 scope=_scope(); principal_body={"scope_hash":scope.scope_hash,"principal_fingerprint":"customer:fixture","representative_authorization_hash":None,"status":"synthetic_verified"}; principal=_made(SyntheticPrincipalBinding,principal_body,"binding_hash")
 policy_body={"scope":scope,"policy_id":"policy:fixture","revision":1,"effective_at":now-timedelta(minutes=1),"expires_at":now+timedelta(minutes=5)}; policy=_made(ContestationPolicyVersion,policy_body,"policy_hash")
 context_body={"run_id":"run-"+"a"*32,"scope_hash":scope.scope_hash,"operator_fingerprint":scope.operator_fingerprint,"fixture_hash":digest("feature20-fixture"),"request_hash":digest("feature20-request"),"status":"requires_revalidation","accepted_as_consent":False,"product_outcome":"unavailable","authority_effect":"none","operation_performed":False,"expires_at":now+timedelta(minutes=5)}; context=_made(Feature20ContextBinding,context_body,"binding_hash")
 sub_body={"scope":scope,"principal":principal,"policy":policy,"feature20_context":context,"category":row["category"],"affected_artifact_hashes":(digest("affected"),),"allegation_fingerprint":digest(row["id"]),"submitted_at":now,"idempotency_hash":digest({"id":row["id"],"run":run_hash})}; submission=_made(ContestationSubmission,sub_body,"submission_hash")
 case_body={"submission_hash":submission.submission_hash,"scope_hash":scope.scope_hash,"case_id":"case:fixture","state":"submitted","created_at":now}; case=_made(ContestationCase,case_body,"case_hash")
 states=("submitted","authenticated","triaged","investigating","finding_issued","response_delivered","appeal_pending","appeal_decided","remedy_pending","closed"); events=[]; predecessor=None
 for i,(before,after) in enumerate(zip(states,states[1:]),1):
  if row["fault"]=="lifecycle" and i==4: before="authenticated"
  body={"case_hash":case.case_hash,"sequence":i,"from_state":before,"to_state":after,"predecessor_hash":predecessor,"observed_at":now+timedelta(seconds=i)}; event=_made(CaseLifecycleEvent,body,"event_hash"); events.append(event); predecessor=event.event_hash
 inv_body={"case_hash":case.case_hash,"reviewer_fingerprint":"reviewer:fixture","qualification_status":"requires_revalidation","scope_hash":scope.scope_hash}; investigation=_made(InvestigationScope,inv_body,"investigation_hash")
 evidence=[] if row["fault"]=="missing" else [_made(InvestigationEvidenceReference,{"investigation_hash":investigation.investigation_hash,"owner":"evidence-owner","artifact_type":"fixture-receipt","artifact_hash":digest("evidence"),"revision":1,"scope_hash":scope.scope_hash,"observed_at":now,"expires_at":now+timedelta(minutes=5),"lifecycle_status":"stale" if row["fault"]=="stale" else "disputed" if row["fault"]=="disputed" else "current","citation_label":"FIXTURE_EVIDENCE"},"reference_hash")]
 actions=[_made(InvestigationActionReceipt,{"investigation_hash":investigation.investigation_hash,"action_code":"verify","observed_at":now},"action_hash")]
 finding_body={"case_hash":case.case_hash,"investigation_hash":investigation.investigation_hash,"reviewer_fingerprint":"reviewer:fixture","outcome":row["finding"],"citation_hashes":tuple(x.reference_hash for x in evidence) or (digest("missing-citation"),),"reason_codes":("CASE_VALID",),"issued_at":now}; finding=_made(CaseFinding,finding_body,"finding_hash")
 response_body={"case_hash":case.case_hash,"finding_hash":finding.finding_hash,"outcome":"failed" if row["fault"]=="delivery" else "delivered","requested_at":now}; response=_made(CustomerResponse,response_body,"response_hash")
 correction_body={"case_hash":case.case_hash,"predecessor_hash":None,"domain_owner":"domain-owner","correction_code":"append"}; intent=_made(DomainCorrectionIntent,correction_body,"intent_hash"); receipt_body={"intent_hash":intent.intent_hash,"predecessor_hash":None,"status":"pending" if row["fault"]=="correction" else "recorded"}; correction=_made(DomainCorrectionReceipt,receipt_body,"receipt_hash")
 proposal_body={"case_hash":case.case_hash,"finding_hash":finding.finding_hash,"remedy_type":"financial","minor_units":1,"asset_code":"USD","chain_id":42161}; proposal=_made(RemedyProposal,proposal_body,"proposal_hash"); auth_body={"proposal_hash":proposal.proposal_hash,"authorizer_fingerprint":"authorizer:fixture","status":"authorized"}; authorization=_made(RemedyAuthorization,auth_body,"authorization_hash"); remedy_body={"authorization_hash":authorization.authorization_hash,"status":"uncertain" if row["fault"]=="uncertain" else "simulated_not_executed","operation_performed":False}; remedy=_made(RemedyExecutionReceipt,remedy_body,"receipt_hash")
 closure_body={"case_hash":case.case_hash,"state_head_hash":events[-1].event_hash,"closure_eligible":row["fault"]=="none"}; closure=_made(CaseClosureReceipt,closure_body,"receipt_hash")
 manifest_body={"scope_hash":scope.scope_hash,"case_hash":case.case_hash,"artifact_hashes":(submission.submission_hash,finding.finding_hash,remedy.receipt_hash),"request_hash":submission.idempotency_hash}; manifest=_made(ContestationBundleManifest,manifest_body,"manifest_hash")
 return {"scope":scope,"submission":submission,"case":case,"events":tuple(events),"investigation":investigation,"evidence":tuple(evidence),"actions":tuple(actions),"finding":finding,"response":response,"correction":correction,"proposal":proposal,"authorization":authorization,"remedy":remedy,"closure":closure,"manifest":manifest,"policy":policy,"principal":principal,"appeal_pending":row["fault"]=="appeal","reviewer_conflict":row["fault"]=="reviewer","feature20_context":context}
def evaluate_fixture(scenario_id,mode,now,operator,run_hash):
 row=next((x for x in scenario_registry() if x["id"]==scenario_id),None)
 if not row: raise ValueError("Unknown checked-in contestation scenario")
 artifacts=build_artifacts(row,now,run_hash); verdict=evaluate(artifacts); result={"scenarioId":scenario_id,"fixtureHash":digest({"scenario":scenario_id,"run":run_hash}),"registryHash":registry_hash(),"invariantVerdict":"pass","eventCount":len(artifacts["events"]),"_artifacts":artifacts}; result.update(safe_projection(artifacts,verdict))
 for key,value in expectations()[scenario_id].items():
  if result.get(key)!=value: raise AssertionError(f"contestation_expectation_failed:{scenario_id}:{key}")
 return result
