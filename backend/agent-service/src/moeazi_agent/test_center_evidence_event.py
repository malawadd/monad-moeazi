"""Feature 25 prerequisite route and same-operator context selection."""
from fastapi import APIRouter,Header,HTTPException,Request
router=APIRouter(prefix="/internal/test-center")
@router.get("/prerequisites/evidence-event-fabric")
async def prerequisites(request:Request,authorization:str|None=Header(default=None),subject:str|None=Header(default=None,alias="X-Moeazi-Subject"),session_id:str|None=Header(default=None,alias="X-Moeazi-Session-Id")):
 from .test_center_api import identity,repository
 return {"runs":await repository(request).prerequisite_runs(identity(authorization,subject,session_id),"evidence-lifecycle-boundary")}
async def select_feature03_context(repository,operator,selected,scope_hash):
 if set(selected or {})!={"evidence-lifecycle-boundary"}: raise HTTPException(409,"Feature 03 prerequisite selection is required")
 value=await repository.get_run(selected["evidence-lifecycle-boundary"],operator)
 if not value or value.get("featureId")!="evidence-lifecycle-boundary": raise HTTPException(409,"Feature 03 prerequisite is foreign or missing")
 result=value.get("result",{})
 if result.get("fixtureOnly") is not True or result.get("productOutcome")!="unavailable" or result.get("authorityEffect")!="none" or result.get("operationPerformed") is not False: raise HTTPException(409,"Feature 03 prerequisite is non-authorizing-invalid")
 from .evidence_event_scope_contracts import SelectedFeature03Context
 return SelectedFeature03Context(value["runId"],operator,scope_hash)
async def selected_context_for_scenario(repository,operator,selected,scenario_id):
 from .evidence_event_scenarios import scenario_registry
 from .evidence_event_scope_contracts import EvidenceFixtureScope
 fixture=next((x for x in scenario_registry() if x["id"]==scenario_id),None)
 if not fixture: raise HTTPException(400,"Unknown checked-in evidence event scenario")
 scope=EvidenceFixtureScope(operator,fixture.get("tenant","tenant-fixture"),fixture.get("account","account-fixture"),fixture.get("scopeKind","public_market_fixture"),42161,fixture.get("market","arb-usdc"))
 return await select_feature03_context(repository,operator,selected,scope.scope_hash)
