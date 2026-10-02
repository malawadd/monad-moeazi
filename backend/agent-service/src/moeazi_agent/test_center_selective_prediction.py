"""Explicit same-operator Feature 30/31/36 prerequisite selection for Feature 37."""
from fastapi import APIRouter, Header, HTTPException, Request
from .selective_prediction_canonical import digest
router = APIRouter(prefix="/internal/test-center")
FEATURES = ("manipulation-aware-evidence-integrity", "portfolio-aware-sizing", "outcome-calibrated-promotion")
SAFE = ("runId", "scenarioId", "createdAt", "invariantVerdict", "requestHash", "controlHash", "registryHash", "fixtureHash", "auditSnapshotHash")
ZEROES = ("providerAttempts", "externalAttempts", "networkAttempts", "workflowAttempts", "signerAttempts", "walletAttempts", "venueAttempts", "executionAttempts", "creditAttempts", "providerCost")

@router.get("/prerequisites/calibrated-selective-prediction")
async def prerequisites(request: Request, authorization: str | None = Header(default=None),
    subject: str | None = Header(default=None, alias="X-Moeazi-Subject"), session_id: str | None = Header(default=None, alias="X-Moeazi-Session-Id")):
    from .test_center_api import authorize, repository
    operator, rows = authorize(authorization, subject, session_id), []
    for feature in FEATURES:
        for row in await repository(request).prerequisite_runs(operator, feature):
            result = row.get("result", {})
            if row.get("invariantVerdict") == "pass" and result.get("fixtureOnly") is True and result.get("productOutcome") == "unavailable":
                rows.append({"featureId": feature, **{key: row.get(key) for key in SAFE}})
    return {"runs": sorted(rows, key=lambda value: (value.get("createdAt") or "", value["runId"]), reverse=True)[:64]}

async def select_context(repository, operator, selected):
    if set(selected or {}) != set(FEATURES): raise HTTPException(409, "One explicit Feature 30, 31, and 36 prerequisite selection is required")
    fields = ("runId", "requestHash", "controlHash", "registryHash", "fixtureHash", "auditSnapshotHash")
    bindings = {}
    for feature in FEATURES:
        row = await repository.get_run(selected[feature], operator); result = (row or {}).get("result", {})
        valid = bool(row and row.get("featureId") == feature and row.get("invariantVerdict") == "pass" and result.get("fixtureOnly") is True and result.get("productOutcome") == "unavailable" and result.get("authorityEffect") == "none" and not any(key not in result or result[key] != 0 for key in ZEROES))
        binding = {key: (row or {}).get(key, "") for key in fields}
        binding.update(resultHash=digest(result), rootHash=result.get("rootHash", ""), persistenceReceiptHash=(row or {}).get("persistenceReceiptHash", (row or {}).get("auditSnapshotHash", "")), trustStatus="requires_revalidation" if valid else "invalid", zeroAttempts=valid, notAuthorizing=valid)
        bindings[feature] = binding
    return bindings
