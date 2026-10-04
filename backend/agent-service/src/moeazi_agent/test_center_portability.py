"""Same-operator Feature 03 prerequisite selection for the isolated portability fixture."""
from fastapi import APIRouter,Header,HTTPException,Request
router=APIRouter(prefix="/internal/test-center")
@router.get("/prerequisites/customer-account-portability")
async def prerequisites(request:Request,authorization:str|None=Header(default=None),subject:str|None=Header(default=None,alias="X-Moeazi-Subject"),session_id:str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
 from .test_center_api import identity,repository
 return {"runs":await repository(request).prerequisite_runs(identity(authorization,subject,session_id),"evidence-lifecycle-boundary")}
async def select_feature03_context(repository,operator,selected):
 if set(selected or {})!={"evidence-lifecycle-boundary"}: raise HTTPException(409,"Feature 03 prerequisite selection is required")
 value=await repository.get_run(selected["evidence-lifecycle-boundary"],operator)
 if not value or value.get("featureId")!="evidence-lifecycle-boundary": raise HTTPException(409,"Feature 03 prerequisite is foreign or missing")
 result=value.get("result",{}); required=("fixtureOnly","productOutcome","authorityEffect","operationPerformed")
 if any(key not in result for key in required) or result.get("fixtureOnly") is not True or result.get("productOutcome")!="unavailable" or result.get("authorityEffect")!="none" or result.get("operationPerformed") is not False: raise HTTPException(409,"Feature 03 prerequisite is non-authorizing-invalid")
 return {"runId":value["runId"],"status":"requires_revalidation","fixtureHash":value.get("fixtureHash"),"requestHash":value.get("requestHash"),"registryHash":value.get("registryHash")}
async def persist_portability(engine,operator,key,request_hash,artifacts,payload):
 from .portability_storage import PortabilityRepository
 return await PortabilityRepository(engine).persist_bundle(operator,key,request_hash,artifacts,payload)
