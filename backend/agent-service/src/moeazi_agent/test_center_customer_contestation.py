"""Feature 23 Test Center prerequisite and repository bridge."""
from fastapi import APIRouter,Header,Request
router=APIRouter(prefix="/internal/test-center")
@router.get("/prerequisites/customer-contestation")
async def prerequisites(request:Request,authorization:str|None=Header(default=None),subject:str|None=Header(default=None,alias="X-Moeazi-Subject"),session_id:str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
 from .test_center_api import identity,repository
 return {"runs":await repository(request).prerequisite_runs(identity(authorization,subject,session_id),"risk-tiered-approval-consent")}
async def select_feature20_context(repository,operator,selected):
 if set(selected or {})!={"risk-tiered-approval-consent"}: raise ValueError("Feature 20 prerequisite selection is required")
 value=await repository.get_run(selected["risk-tiered-approval-consent"],operator)
 if not value or value.get("featureId")!="risk-tiered-approval-consent": raise ValueError("Feature 20 prerequisite is foreign or missing")
 result=value.get("result",{}); required=("fixtureOnly","productOutcome","authorityEffect","operationPerformed")
 if any(key not in result for key in required) or result.get("fixtureOnly") is not True or result.get("productOutcome")!="unavailable" or result.get("authorityEffect")!="none" or result.get("operationPerformed") is not False: raise ValueError("Feature 20 prerequisite is non-authorizing-invalid")
 return {"runId":value["runId"],"status":"requires_revalidation","fixtureHash":value.get("fixtureHash")}
async def persist_customer_contestation(engine,operator,key,request_hash,artifacts,payload):
 from .customer_contestation_storage import ContestationRepository
 return await ContestationRepository(engine).persist_bundle(operator,key,request_hash,artifacts,payload)
