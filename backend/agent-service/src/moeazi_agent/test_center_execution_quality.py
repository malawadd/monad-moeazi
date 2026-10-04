"""Same-operator Feature 31 selection, with no authority or identity transfer."""
from fastapi import APIRouter,Header,HTTPException,Request
from .execution_quality_canonical import digest
router=APIRouter(prefix="/internal/test-center")
@router.get("/prerequisites/multi-venue-execution-quality-routing")
async def prerequisites(request:Request,authorization:str|None=Header(default=None),subject:str|None=Header(default=None,alias="X-Moeazi-Subject"),session_id:str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
 from .test_center_api import authorize,repository
 operator=authorize(authorization,subject,session_id); rows=[]
 for row in await repository(request).prerequisite_runs(operator,"portfolio-aware-sizing"):
  result=row.get("result",{})
  if result.get("decision") in {"approve_for_routing","clamped"}:
   rows.append({key:row.get(key) for key in ("runId","scenarioId","createdAt","invariantVerdict","registryHash","controlHash","requestHash","fixtureHash")})
 return {"runs":rows[:64]}
async def select_context(repository,operator,selected):
 if set(selected or {})!={"portfolio-aware-sizing"}: raise HTTPException(409,"One explicit Feature 31 prerequisite selection is required")
 row=await repository.get_run(selected["portfolio-aware-sizing"],operator); result=(row or {}).get("result",{})
 if not row or row.get("featureId")!="portfolio-aware-sizing" or row.get("invariantVerdict")!="pass" or result.get("fixtureOnly") is not True or result.get("productOutcome")!="unavailable" or result.get("authorityEffect")!="none" or result.get("decision") not in {"approve_for_routing","clamped"} or result.get("quantity",0)<=0 or any(result.get(key,0)!=0 for key in ("providerAttempts","externalAttempts","signerAttempts","walletAttempts","venueAttempts")): raise HTTPException(409,"Execution-quality prerequisite is foreign, missing, or non-authorizing")
 binding={key:row.get(key) for key in ("runId","requestHash","controlHash","registryHash","fixtureHash","auditSnapshotHash")}
 return {"trustStatus":"requires_revalidation","predecessors":binding,"contextHash":digest(binding),"decision":result["decision"],"quantity":result["quantity"],"notional":result.get("approvedNotional",0)}
