"""Deterministic local-only Feature 24 graph evaluator."""
from __future__ import annotations
from .portability_registry import DOMAIN_IDS,domain,registry,registry_hash
from .portability_canonical import digest
from .portability_scope_contracts import PortabilityScope,SyntheticStepUpBinding,Feature03ExportContext,UsageRightsStatus
from .portability_policy_contracts import DomainPolicy,PortabilityPolicyVersion
from .portability_domain_contracts import DomainExportDefinition,DomainExportPlan,NativeCutoff,PortableSourceRecord,OmissionRecord,DomainExportSnapshotReceipt
from .portability_package_contracts import PortableExportManifest,ExportAssemblyReceipt,ExportVerificationReceipt
from .portability_delivery_contracts import TransientDeliveryGrant,ExportDeliveryAttempt,ExportDeliveryReceipt,ExportCleanupReceipt
from .portability_bundle_contracts import PortabilityStateSnapshot,PortabilityRootManifest
from .portability_serializer import serialize_domain,clear_buffers
def _root(items): return digest([getattr(x,"record_hash",getattr(x,"descriptor_hash",getattr(x,"omission_hash",""))) for x in items])
def _status(statuses,verified):
 if not verified or "blocked" in statuses:return "blocked"
 return "complete" if set(statuses)=={"complete"} else "partial"
def replay_identity(request,mode):
 """Fast deterministic preflight used for replay/property validation before assembly."""
 if mode not in {"observe","enforce"}: raise ValueError("portability_mode_invalid")
 operation=request.get("operation","inspect_export")
 if operation not in registry()["operations"]: raise ValueError("portability_operation_invalid")
 tenant=request.get("tenant","tenant:fixture"); account=request.get("account","account:fixture"); bound=request.get("domainBinding","all")
 if bound!="all" and bound not in DOMAIN_IDS: raise ValueError("portability_domain_binding_invalid")
 scope=PortabilityScope(request.get("operator","operator:fixture"),tenant,account)
 return digest({"scope":scope.scope_hash,"operation":operation,"domainBinding":bound,"request":request.get("request","request:fixture"),"mode":mode})
def validate_graph(graph):
 """Reject cross-scope, operation, link, descriptor, and closure substitution before storage."""
 required={"scope","context","plans","receipts","files","manifest","assembly","verification","grant","delivery","cleanup","state","root","operation","operationHash"}
 if not required.issubset(graph) or graph["operation"] not in registry()["operations"]: raise ValueError("portability_graph_operation_invalid")
 scope=graph["scope"]; manifest=graph["manifest"]
 if manifest.scope_hash!=scope.scope_hash or graph["context"].scope_hash!=scope.scope_hash or graph["root"].scope_hash!=scope.scope_hash: raise ValueError("portability_graph_scope_reuse")
 if graph["operationHash"]!=digest({"operation":graph["operation"],"request":graph["root"].request_hash}): raise ValueError("portability_graph_operation_reuse")
 plans={x.plan_hash:x for x in graph["plans"]}
 if len(plans)!=10 or set(x.definition.domain_id for x in plans.values())!=set(DOMAIN_IDS): raise ValueError("portability_graph_plan_closure")
 if any(x.plan_hash not in plans or x.domain_id!=plans[x.plan_hash].definition.domain_id for x in graph["receipts"]): raise ValueError("portability_graph_receipt_link")
 if tuple(graph["receipts"])!=manifest.receipts or tuple(graph["files"])!=manifest.files: raise ValueError("portability_graph_manifest_link")
 paths=[x.path for x in graph["files"]]
 if len(paths)!=len(set(paths)) or len({x.casefold() for x in paths})!=len(paths): raise ValueError("portability_graph_path_link")
 if graph["assembly"].manifest_hash!=manifest.manifest_hash or graph["verification"].manifest_hash!=manifest.manifest_hash or graph["grant"].manifest_hash!=manifest.manifest_hash: raise ValueError("portability_graph_manifest_reuse")
 if graph["state"].manifest_hash!=manifest.manifest_hash or graph["root"].manifest_hash!=manifest.manifest_hash: raise ValueError("portability_graph_root_link")
 if graph.get("attempt") and (graph["attempt"].sequence!=1 or graph["attempt"].grant_hash!=graph["grant"].grant_hash): raise ValueError("portability_graph_attempt_order")
 if graph["cleanup"].state=="cleared" and (graph["cleanup"].residual_file_count or graph["cleanup"].residual_bytes): raise ValueError("portability_graph_cleanup_residual")
 return graph
def evaluate(request,mode="observe",now=None):
 """Build from a closed fixture request; never returns virtual bytes."""
 if mode not in {"observe","enforce"}: raise ValueError("portability_mode_invalid")
 operation=request.get("operation","inspect_export")
 if operation not in registry()["operations"]: raise ValueError("portability_operation_invalid")
 fault=request.get("fault","none"); operator=request.get("operator","operator:fixture")
 tenant=request.get("tenant","tenant:fixture"); account=request.get("account","account:fixture"); domain_binding=request.get("domainBinding","all")
 if domain_binding!="all" and domain_binding not in DOMAIN_IDS: raise ValueError("portability_domain_binding_invalid")
 scope=PortabilityScope(operator,tenant,account); step=SyntheticStepUpBinding(scope.scope_hash)
 req_hash=digest({"scenario":request.get("id","fixture"),"operation":operation,"operator":operator,"tenant":tenant,"account":account,"domainBinding":domain_binding,"request":request.get("request","request:fixture")})
 context=Feature03ExportContext(request.get("feature03RunId","run-"+"a"*32),scope.scope_hash,digest("fixture03"),req_hash,registry_hash(),digest("control"),digest("prerequisite"),digest("lifecycle"))
 usage=UsageRightsStatus(request.get("usageRights","unavailable"))
 policies=tuple(DomainPolicy(d) for d in DOMAIN_IDS); policy=PortabilityPolicyVersion("policy:fixture",1,policies)
 all_files={}; descriptors=[]; receipts=[]; omissions=[]; plans=[]; reason=[]
 try:
  for index,did in enumerate(DOMAIN_IDS,1):
   info=domain(did); cutoff=NativeCutoff(info["cutoff"],index if info["cutoff"]!="public_chain_reference" else f"block:{index}")
   plan=DomainExportPlan(req_hash,policy.policy_hash,registry_hash(),DomainExportDefinition(did),cutoff); plans.append(plan)
   status="complete"; records=(PortableSourceRecord(did,f"record-{index}",1,index,(("classification","synthetic"),("value",index))),)
   local_omissions=()
   if fault in {"owner_outage","required_blocked"} and index==1: status="blocked"; records=(); reason.append("OWNER_UNAVAILABLE")
   elif fault in {"optional_omitted","hold","stale","disputed","post_cutoff"} and index==1:
    status="omitted" if fault=="optional_omitted" else "partial"; records=(); code={"hold":"LEGAL_HOLD","stale":"LIFECYCLE_STALE","disputed":"LIFECYCLE_DISPUTED","post_cutoff":"POST_CUTOFF","optional_omitted":"FIELD_REDACTED"}[fault]; local_omissions=(OmissionRecord(did,"record-1","synthetic",code),); reason.append(code)
   files,desc=serialize_domain(plan,records) if status not in {"blocked","unavailable","omitted"} else ({},())
   all_files.update(files); descriptors.extend(desc); omissions.extend(local_omissions)
   receipts.append(DomainExportSnapshotReceipt(plan.plan_hash,did,status,len(records),len(records),len(local_omissions),0,_root(desc),_root(local_omissions)))
  verified=fault not in {"checksum","schema","manifest","path","cleanup_failure"}
  package_status=_status([x.status for x in receipts],verified)
  manifest=PortableExportManifest(req_hash,scope.scope_hash,policy.policy_hash,registry_hash(),context.context_hash,tuple(receipts),tuple(descriptors),tuple(omissions),package_status)
  assembly=ExportAssemblyReceipt(manifest.manifest_hash,len(descriptors),sum(len(x) for x in all_files.values()),"assembled" if package_status!="blocked" else "blocked")
  verification=ExportVerificationReceipt(manifest.manifest_hash,verified and package_status!="blocked",None if verified else "CHECKSUM_INVALID")
  grant_state="would_issue" if mode=="observe" else ("issued" if verification.verified else "blocked")
  grant=TransientDeliveryGrant(manifest.manifest_hash,mode,digest({"nonce":req_hash}),grant_state)
  attempt=None; delivery_state="not_attempted"
  if mode=="enforce" and grant_state=="issued":
   delivery_state={"replay":"replay_blocked","expired":"expired","revoked":"revoked"}.get(fault,"consumed")
   attempt=ExportDeliveryAttempt(grant.grant_hash,1,delivery_state)
  delivery=ExportDeliveryReceipt(grant.grant_hash,delivery_state)
  clear_buffers(all_files)
  cleanup=ExportCleanupReceipt(manifest.manifest_hash,"failed" if fault=="cleanup_failure" else "cleared",1 if fault=="cleanup_failure" else 0,1 if fault=="cleanup_failure" else 0)
  if cleanup.state!="cleared": package_status="blocked"; reason.append("CLEANUP_FAILED")
  state=PortabilityStateSnapshot(manifest.manifest_hash,verification.receipt_hash,grant.grant_hash,cleanup.receipt_hash); root=PortabilityRootManifest(scope.scope_hash,req_hash,manifest.manifest_hash,state.snapshot_hash)
  return validate_graph({"scope":scope,"stepUp":step,"context":context,"usageRights":usage,"policy":policy,"plans":tuple(plans),"receipts":tuple(receipts),"files":tuple(descriptors),"omissions":tuple(omissions),"manifest":manifest,"assembly":assembly,"verification":verification,"grant":grant,"attempt":attempt,"delivery":delivery,"cleanup":cleanup,"state":state,"root":root,"operation":operation,"operationHash":digest({"operation":operation,"request":req_hash}),"packageStatus":package_status,"reasons":tuple(sorted(set(reason))),"fixtureHash":digest(request)})
 finally:
  clear_buffers(all_files)
