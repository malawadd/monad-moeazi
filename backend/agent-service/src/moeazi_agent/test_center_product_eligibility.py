"""Feature 22 Test Center prerequisite and persistence boundary."""
from fastapi import APIRouter,Header,Request
from .product_eligibility_test_center_adapter import evaluate
router=APIRouter(prefix="/internal/test-center")
@router.get("/prerequisites/external-product-eligibility")
async def prerequisites(request:Request,authorization:str|None=Header(default=None),subject:str|None=Header(default=None,alias="X-Moeazi-Subject"),session_id:str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
 from .test_center_api import identity,repository
 return {"runs":await repository(request).prerequisite_runs(identity(authorization,subject,session_id),"external-usage-rights")}
async def select_feature21_context(repository,operator,selected):
 if set(selected or {})!={"external-usage-rights"}: raise ValueError("Feature 21 prerequisite selection is required")
 value=await repository.get_run(selected["external-usage-rights"],operator)
 if not value or value.get("featureId")!="external-usage-rights": raise ValueError("Feature 21 prerequisite is foreign or missing")
 result=value.get("result",{})
 required=("fixtureOnly","productOutcome","authorityEffect","operationPerformed")
 if any(key not in result for key in required) or result.get("fixtureOnly") is not True or result.get("productOutcome")!="unavailable" or result.get("authorityEffect")!="none" or result.get("operationPerformed") is not False: raise ValueError("Feature 21 prerequisite is non-authorizing-invalid")
 return {"runId":value["runId"],"status":"requires_revalidation","fixtureHash":value.get("fixtureHash")}
async def persist_product_eligibility(engine,operator,idempotency_key,request_hash,artifacts,payload):
 from .product_eligibility_storage import ProductEligibilityRepository
 return await ProductEligibilityRepository(engine).persist_bundle(operator,idempotency_key,request_hash,artifacts["request"].scope,artifacts,payload)
