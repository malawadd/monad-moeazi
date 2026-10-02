"""Same-operator prerequisite binding for local Feature 30 research only."""
from fastapi import APIRouter,Header,HTTPException,Request
from .evidence_integrity_canonical import digest
router=APIRouter(prefix="/internal/test-center")
FEATURES=("evidence-lifecycle-boundary","external-usage-rights","evidence-event-fabric","claim-disagreement-ledger","specialist-source-value-attribution")
@router.get("/prerequisites/manipulation-aware-evidence-integrity")
async def prerequisites(request:Request,authorization:str|None=Header(default=None),subject:str|None=Header(default=None,alias="X-Moeazi-Subject"),session_id:str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
 from .test_center_api import authorize,repository
 operator=authorize(authorization,subject,session_id); rows=[]
 for feature in FEATURES:
  for row in await repository(request).prerequisite_runs(operator,feature):
   rows.append({"featureId":feature,"runId":row.get("runId"),"scenarioId":row.get("scenarioId"),"createdAt":row.get("createdAt"),"invariantVerdict":row.get("invariantVerdict"),"registryHash":row.get("registryHash"),"controlHash":row.get("controlHash"),"requestHash":row.get("requestHash"),"resultHash":row.get("fixtureHash"),"trustStatus":"requires_revalidation"})
 return {"runs":rows}
async def select_context(repository,operator,selected):
 if set(selected or {})!=set(FEATURES): raise HTTPException(409,"Five explicit Feature 30 prerequisite selections are required")
 bound={}
 for feature,run_id in selected.items():
  row=await repository.get_run(run_id,operator); result=(row or {}).get("result",{})
  if not row or row.get("featureId")!=feature or row.get("invariantVerdict")!="pass" or result.get("fixtureOnly") is not True or result.get("productOutcome")!="unavailable" or result.get("authorityEffect")!="none": raise HTTPException(409,"Evidence-integrity prerequisite is foreign, missing, or non-authorizing")
  bound[feature]={key:row.get(key) for key in ("runId","requestHash","controlHash","registryHash","fixtureHash","auditSnapshotHash")}
 return {"trustStatus":"requires_revalidation","predecessors":bound,"contextHash":digest(bound)}
