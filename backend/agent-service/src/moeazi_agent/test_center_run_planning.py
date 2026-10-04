"""Same-operator Feature 25/29 context is inspection-only and requires revalidation."""
from fastapi import APIRouter,Header,HTTPException,Request
from .run_planning_canonical import digest
router=APIRouter(prefix="/internal/test-center")
@router.get("/prerequisites/deterministic-run-planning")
async def prerequisites(request:Request,authorization:str|None=Header(default=None),subject:str|None=Header(default=None,alias="X-Moeazi-Subject"),session_id:str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
 from .test_center_api import authorize,repository
 operator=authorize(authorization,subject,session_id); runs=[]
 for feature in ("evidence-event-fabric","specialist-source-value-attribution"):
  for row in await repository(request).prerequisite_runs(operator,feature):
   if row.get("invariantVerdict")=="pass": runs.append({key:row.get(key) for key in ("featureId","runId","scenarioId","createdAt","invariantVerdict","registryHash","controlHash","requestHash","fixtureHash")})
 return {"runs":sorted(runs,key=lambda x:(str(x.get("createdAt")),str(x.get("runId"))),reverse=True)[:64]}
async def select_context(repository,operator,selected):
 required={"evidence-event-fabric","specialist-source-value-attribution"}
 if set(selected or {})!=required: raise HTTPException(409,"One explicit Feature 25 and Feature 29 selection is required")
 rows={feature:await repository.get_run(selected[feature],operator) for feature in required}
 for feature,row in rows.items():
  result=(row or {}).get("result",{}); zeros=("providerAttempts","externalAttempts","signerAttempts","walletAttempts","venueAttempts")
  if not row or row.get("featureId")!=feature or row.get("invariantVerdict")!="pass" or result.get("fixtureOnly") is not True or result.get("productOutcome")!="unavailable" or result.get("authorityEffect")!="none" or any(result.get(key,0)!=0 for key in zeros): raise HTTPException(409,"Run-planning prerequisite is foreign, missing, or non-authorizing")
 binding={feature:{key:row.get(key) for key in ("runId","requestHash","controlHash","registryHash","fixtureHash","auditSnapshotHash")} for feature,row in rows.items()}
 return {"trustStatus":"requires_revalidation","predecessors":binding,"contextHash":digest(binding),"zeroAttempts":True,"notAuthorizing":True}
