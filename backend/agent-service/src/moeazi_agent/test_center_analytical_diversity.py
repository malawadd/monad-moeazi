"""Explicit same-operator prerequisite selection for Feature 38."""
from fastapi import APIRouter, Header, HTTPException, Request
from .analytical_diversity_canonical import digest
router=APIRouter(prefix="/internal/test-center")
FEATURES=("claim-disagreement-ledger","manipulation-aware-evidence-integrity","outcome-linked-decision-memory","outcome-calibrated-promotion","calibrated-selective-prediction")
ZERO=("providerAttempts","externalAttempts","networkAttempts","workflowAttempts","signerAttempts","walletAttempts","venueAttempts","executionAttempts","creditAttempts","providerCost")
@router.get("/prerequisites/analytical-diversity-audit")
async def prerequisites(request:Request,authorization:str|None=Header(default=None),subject:str|None=Header(default=None,alias="X-Moeazi-Subject"),session_id:str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
 from .test_center_api import authorize,repository
 operator=authorize(authorization,subject,session_id); rows=[]
 for feature in FEATURES:
  for row in await repository(request).prerequisite_runs(operator,feature):
   result=row.get("result",{})
   if row.get("invariantVerdict")=="pass" and result.get("fixtureOnly") is True and result.get("productOutcome")=="unavailable": rows.append({"featureId":feature,"runId":row.get("runId"),"scenarioId":row.get("scenarioId"),"createdAt":row.get("createdAt")})
 return {"runs":sorted(rows,key=lambda row:(row.get("createdAt") or "",row["runId"]),reverse=True)[:64]}
async def select_context(repository,operator,selected):
 if set(selected or {})!=set(FEATURES): raise HTTPException(409,"One explicit Feature 28, 30, 35, 36, and 37 prerequisite selection is required")
 bindings={}
 for feature in FEATURES:
  row=await repository.get_run(selected[feature],operator); result=(row or {}).get("result",{})
  valid=bool(row and row.get("featureId")==feature and row.get("invariantVerdict")=="pass" and result.get("fixtureOnly") is True and result.get("productOutcome")=="unavailable" and result.get("authorityEffect")=="none" and not any(result.get(key)!=0 for key in ZERO))
  bindings[feature]={"runId":selected[feature],"resultHash":digest(result),"rootHash":result.get("rootHash","") if valid else "0"*64,"trustStatus":"requires_revalidation" if valid else "invalid","zeroAttempts":valid,"notAuthorizing":valid}
 return bindings
