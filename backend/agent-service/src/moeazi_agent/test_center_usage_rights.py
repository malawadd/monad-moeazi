"""Feature 21 Test Center boundary. It deliberately has no product capability."""
from fastapi import APIRouter, Header, Request
from .usage_rights_test_center_adapter import evaluate
router = APIRouter(prefix="/internal/test-center")
@router.get("/prerequisites/external-usage-rights")
async def prerequisites(request: Request, authorization: str | None = Header(default=None), subject: str | None = Header(default=None, alias="X-Moeazi-Subject"), session_id: str | None = Header(default=None, alias="X-Moeazi-Session-Id")):
    from .test_center_api import identity, repository
    return {"runs": await repository(request).prerequisite_runs(identity(authorization,subject,session_id),"evidence-lifecycle-boundary")}

async def evaluate_usage_rights(scenario_id, mode, now, operator, run_hash):
    return evaluate(scenario_id, mode, now, operator, run_hash)


async def select_feature03_context(repository, operator, selected):
    if set(selected or {}) != {"evidence-lifecycle-boundary"}: raise ValueError("Feature 03 prerequisite selection is required")
    value = await repository.get_run(selected["evidence-lifecycle-boundary"], operator)
    if not value or value.get("featureId") != "evidence-lifecycle-boundary": raise ValueError("Feature 03 prerequisite is foreign or missing")
    return {"runId": value["runId"], "decisionHash": value.get("fixtureHash"), "status": "requires_revalidation"}


async def persist_usage_rights(engine, operator, idempotency_key, request_hash, artifacts, payload):
    """Persist the Feature 21 graph and Test Center bundle in one transaction."""
    from .usage_rights_storage import UsageRightsRepository
    request, decision = artifacts["request"], artifacts["decision"]
    return await UsageRightsRepository(engine).persist(operator, idempotency_key, request_hash,
        request.scope, request, decision, payload, save_generic=True)
