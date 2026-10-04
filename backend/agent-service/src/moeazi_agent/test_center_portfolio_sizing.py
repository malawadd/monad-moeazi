"""Same-operator Feature 09 prerequisite selection; never transfers authority."""
from fastapi import APIRouter,Header,HTTPException,Request
from .portfolio_sizing_canonical import digest
router=APIRouter(prefix="/internal/test-center")
@router.get("/prerequisites/portfolio-aware-sizing")
async def prerequisites(request:Request,authorization:str|None=Header(default=None),subject:str|None=Header(default=None,alias="X-Moeazi-Subject"),session_id:str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
 from .test_center_api import authorize,repository
 operator=authorize(authorization,subject,session_id); rows=[]
 for row in await repository(request).prerequisite_runs(operator,"authoritative-risk-snapshot-and-reconciliation"):
  rows.append({"featureId":"authoritative-risk-snapshot-and-reconciliation","runId":row.get("runId"),"scenarioId":row.get("scenarioId"),"createdAt":row.get("createdAt"),"invariantVerdict":row.get("invariantVerdict"),"registryHash":row.get("registryHash"),"controlHash":row.get("controlHash"),"requestHash":row.get("requestHash"),"resultHash":row.get("fixtureHash"),"trustStatus":"requires_revalidation"})
 return {"runs":rows[:64]}
async def select_context(repository,operator,selected):
 expected={"authoritative-risk-snapshot-and-reconciliation"}
 if set(selected or {})!=expected: raise HTTPException(409,"One explicit Feature 09 prerequisite selection is required")
 run_id=selected["authoritative-risk-snapshot-and-reconciliation"]; row=await repository.get_run(run_id,operator); result=(row or {}).get("result",{})
 if not row or row.get("featureId") not in expected or row.get("invariantVerdict")!="pass" or result.get("fixtureOnly") is not True or result.get("productOutcome")!="unavailable" or result.get("authorityEffect")!="none": raise HTTPException(409,"Portfolio sizing prerequisite is foreign, missing, or non-authorizing")
 binding={key:row.get(key) for key in ("runId","requestHash","controlHash","registryHash","fixtureHash","auditSnapshotHash")}
 return {"trustStatus":"requires_revalidation","predecessors":binding,"contextHash":digest(binding)}
