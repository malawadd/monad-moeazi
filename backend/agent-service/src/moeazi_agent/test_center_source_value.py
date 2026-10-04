"""Same-operator prerequisite selection for Feature 29, never authority."""
from fastapi import APIRouter,Header,HTTPException,Request
from .source_value_canonical import digest
router=APIRouter(prefix="/internal/test-center")
@router.get("/prerequisites/specialist-source-value-attribution")
async def prerequisites(request:Request,authorization:str|None=Header(default=None),subject:str|None=Header(default=None,alias="X-Moeazi-Subject"),session_id:str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
 from .test_center_api import authorize,repository
 operator=authorize(authorization,subject,session_id); rows=[]
 for feature in ("evidence-event-fabric","claim-disagreement-ledger"):
  for row in await repository(request).prerequisite_runs(operator,feature):
   rows.append({"featureId":feature,"runId":row.get("runId"),"scenarioId":row.get("scenarioId"),"createdAt":row.get("createdAt"),"invariantVerdict":row.get("invariantVerdict"),"registryHash":row.get("registryHash"),"controlHash":row.get("controlHash"),"requestHash":row.get("requestHash"),"resultHash":row.get("fixtureHash"),"trustStatus":"requires_revalidation"})
 return {"runs":rows}
async def select_context(repository,operator,selected):
 expected={"evidence-event-fabric","claim-disagreement-ledger"}
 if set(selected or {})!=expected: raise HTTPException(409,"Feature 25 and Feature 28 prerequisite selections are required")
 bound={}
 for feature,run_id in selected.items():
  row=await repository.get_run(run_id,operator); result=(row or {}).get("result",{})
  if not row or row.get("featureId")!=feature or row.get("invariantVerdict")!="pass" or result.get("fixtureOnly") is not True or result.get("productOutcome")!="unavailable" or result.get("authorityEffect")!="none": raise HTTPException(409,"Source-value prerequisite is foreign, missing, or non-authorizing")
  bound[feature]={key:row.get(key) for key in ("runId","requestHash","controlHash","registryHash","fixtureHash","auditSnapshotHash")}
 return {"trustStatus":"requires_revalidation","predecessors":bound,"contextHash":digest(bound)}
