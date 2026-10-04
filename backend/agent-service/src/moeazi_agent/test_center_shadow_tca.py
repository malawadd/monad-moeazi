"""Same-operator Feature 32 context selection without authority transfer."""
from fastapi import APIRouter,Header,HTTPException,Request
from .shadow_tca_canonical import digest
router=APIRouter(prefix="/internal/test-center")
@router.get("/prerequisites/calibrated-shadow-execution-tca")
async def prerequisites(request:Request,authorization:str|None=Header(default=None),subject:str|None=Header(default=None,alias="X-Moeazi-Subject"),session_id:str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
 from .test_center_api import authorize,repository
 operator=authorize(authorization,subject,session_id); rows=[]
 for row in await repository(request).prerequisite_runs(operator,"multi-venue-execution-quality-routing"):
  result=row.get("result",{})
  if result.get("decision") in {"hypothetical_route","abstain_no_synthetic_route"}:
   rows.append({key:row.get(key) for key in ("runId","scenarioId","createdAt","invariantVerdict","registryHash","controlHash","requestHash","fixtureHash")})
 return {"runs":rows[:64]}
async def select_context(repository,operator,selected):
 if set(selected or {})!={"multi-venue-execution-quality-routing"}: raise HTTPException(409,"One explicit Feature 32 prerequisite selection is required")
 row=await repository.get_run(selected["multi-venue-execution-quality-routing"],operator); result=(row or {}).get("result",{})
 zero=("providerAttempts","externalAttempts","signerAttempts","walletAttempts","venueAttempts")
 if not row or row.get("featureId")!="multi-venue-execution-quality-routing" or row.get("invariantVerdict")!="pass" or result.get("fixtureOnly") is not True or result.get("productOutcome")!="unavailable" or result.get("authorityEffect")!="none" or result.get("decision") not in {"hypothetical_route","abstain_no_synthetic_route"} or any(result.get(key,0)!=0 for key in zero): raise HTTPException(409,"Shadow/TCA prerequisite is foreign, missing, or non-authorizing")
 binding={key:row.get(key) for key in ("runId","requestHash","controlHash","registryHash","fixtureHash","auditSnapshotHash")}
 return {"trustStatus":"requires_revalidation","predecessors":binding,"contextHash":digest(binding),"decision":result["decision"],"zeroAttempts":True,"notAuthorizing":True}
