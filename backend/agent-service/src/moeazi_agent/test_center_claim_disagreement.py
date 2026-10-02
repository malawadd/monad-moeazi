"""Feature 25 context stays explicitly untrusted and same-operator scoped."""
from fastapi import APIRouter,Header,HTTPException,Request
router=APIRouter(prefix="/internal/test-center")
@router.get("/prerequisites/claim-disagreement-ledger")
async def prerequisites(request:Request,authorization:str|None=Header(default=None),subject:str|None=Header(default=None,alias="X-Moeazi-Subject"),session_id:str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
 from .test_center_api import authorize,repository
 operator=authorize(authorization,subject,session_id)
 runs=await repository(request).prerequisite_runs(operator,"evidence-event-fabric")
 return {"runs":[{"runId":x.get("runId"),"scenarioId":x.get("scenarioId"),"createdAt":x.get("createdAt"),"invariantVerdict":x.get("invariantVerdict"),"registryHash":x.get("registryHash"),"controlHash":x.get("controlHash"),"requestHash":x.get("requestHash"),"resultHash":x.get("fixtureHash"),"trustStatus":"requires_revalidation"} for x in runs]}
async def select_context(repository,operator,selected):
 if set(selected or {})!={"evidence-event-fabric"}: raise HTTPException(409,"Feature 25 prerequisite selection is required")
 item=await repository.get_run(selected["evidence-event-fabric"],operator)
 if not item or item.get("featureId")!="evidence-event-fabric": raise HTTPException(409,"Feature 25 prerequisite is foreign or missing")
 result=item.get("result",{})
 if result.get("fixtureOnly") is not True or result.get("productOutcome")!="unavailable" or result.get("authorityEffect")!="none": raise HTTPException(409,"Feature 25 prerequisite is non-authorizing-invalid")
 from .claim_disagreement_canonical import digest
 return {"runId":item["runId"],"trustStatus":"requires_revalidation","contextHash":digest({"run":item["runId"],"request":item.get("requestHash"),"control":item.get("controlHash"),"registry":item.get("registryHash"),"result":item.get("fixtureHash")})}
