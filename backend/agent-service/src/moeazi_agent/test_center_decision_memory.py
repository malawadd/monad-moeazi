"""Feature 25 prerequisite selection for local decision-memory fixtures."""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from .decision_memory_canonical import digest

router = APIRouter(prefix="/internal/test-center")


@router.get("/prerequisites/outcome-linked-decision-memory")
async def prerequisites(request: Request, authorization: str | None = Header(default=None),
                        subject: str | None = Header(default=None, alias="X-Moeazi-Subject"),
                        session_id: str | None = Header(default=None, alias="X-Moeazi-Session-Id")):
    from .test_center_api import authorize, repository
    operator = authorize(authorization, subject, session_id)
    rows = await repository(request).prerequisite_runs(operator, "evidence-event-fabric")
    safe = ("featureId", "runId", "scenarioId", "createdAt", "invariantVerdict", "requestHash",
            "controlHash", "registryHash", "fixtureHash", "auditSnapshotHash")
    return {"runs": [{key: row.get(key) for key in safe} for row in rows
            if row.get("invariantVerdict") == "pass"][:64]}


async def select_context(repository, operator: str, selected: dict[str, str] | None, scope_hash: str) -> dict:
    if set(selected or {}) != {"evidence-event-fabric"}:
        raise HTTPException(409, "One explicit Feature 25 prerequisite selection is required")
    row = await repository.get_run(selected["evidence-event-fabric"], operator)
    result = (row or {}).get("result", {})
    zeroes = ("providerAttempts", "externalAttempts", "workflowAttempts", "signerAttempts", "walletAttempts", "venueAttempts")
    if (not row or row.get("featureId") != "evidence-event-fabric" or row.get("invariantVerdict") != "pass"
            or result.get("fixtureOnly") is not True or result.get("productOutcome") != "unavailable"
            or result.get("authorityEffect") != "none" or result.get("runtimeDispatch") != "unavailable"
            or any(result.get(key, 0) != 0 for key in zeroes)):
        raise HTTPException(409, "Feature 25 prerequisite is foreign, incomplete, or non-authorizing")
    binding = {key: row.get(key) for key in ("runId", "requestHash", "controlHash", "registryHash", "fixtureHash", "auditSnapshotHash")}
    binding["resultHash"] = digest(result); binding["scopeHash"] = scope_hash
    return {"trustStatus": "requires_revalidation", "predecessors": binding,
            "contextHash": digest(binding), "zeroAttempts": True, "notAuthorizing": True}
