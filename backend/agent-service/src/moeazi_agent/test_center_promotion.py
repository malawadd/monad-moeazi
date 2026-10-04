"""Explicit same-operator Feature 33/35 prerequisite selection for Feature 36."""
from fastapi import APIRouter, Header, HTTPException, Request
from .promotion_canonical import digest
router = APIRouter(prefix="/internal/test-center")
FEATURES = ("calibrated-shadow-execution-tca", "outcome-linked-decision-memory")


@router.get("/prerequisites/outcome-calibrated-promotion")
async def prerequisites(request: Request, authorization: str | None = Header(default=None),
                        subject: str | None = Header(default=None, alias="X-Moeazi-Subject"),
                        session_id: str | None = Header(default=None, alias="X-Moeazi-Session-Id")):
    from .test_center_api import authorize, repository
    operator = authorize(authorization, subject, session_id)
    safe = ("runId", "scenarioId", "createdAt", "invariantVerdict", "requestHash",
            "controlHash", "registryHash", "fixtureHash", "auditSnapshotHash")
    rows = []
    for feature in FEATURES:
        for row in await repository(request).prerequisite_runs(operator, feature):
            result = row.get("result", {})
            if row.get("invariantVerdict") == "pass" and result.get("fixtureOnly") is True and result.get("productOutcome") == "unavailable":
                rows.append({"featureId": feature, **{key: row.get(key) for key in safe}})
    return {"runs": sorted(rows, key=lambda value: (value.get("createdAt") or "", value["runId"]), reverse=True)[:64]}


async def select_context(repository, operator, selected):
    if set(selected or {}) != set(FEATURES):
        raise HTTPException(409, "One explicit Feature 33 and Feature 35 prerequisite selection is required")
    fields = ("runId", "requestHash", "controlHash", "registryHash", "fixtureHash", "auditSnapshotHash")
    zeroes = ("providerAttempts", "externalAttempts", "networkAttempts", "workflowAttempts", "signerAttempts", "walletAttempts", "venueAttempts", "executionAttempts", "creditAttempts", "providerCost")
    bindings = {}
    for feature in FEATURES:
        row = await repository.get_run(selected[feature], operator)
        result = (row or {}).get("result", {})
        valid = bool(row and row.get("featureId") == feature and row.get("invariantVerdict") == "pass" and result.get("fixtureOnly") is True and result.get("productOutcome") == "unavailable" and result.get("authorityEffect") == "none" and not any(key not in result or result[key] != 0 for key in zeroes))
        binding = {key: (row or {}).get(key, "") for key in fields}
        binding.update(resultHash=digest(result), rootHash=result.get("rootHash", ""),
                       persistenceReceiptHash=(row or {}).get("persistenceReceiptHash", (row or {}).get("auditSnapshotHash", "")),
                       trustStatus="requires_revalidation" if valid else "invalid",
                       zeroAttempts=valid, notAuthorizing=valid)
        bindings[feature] = binding
    return bindings
