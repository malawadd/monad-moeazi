from __future__ import annotations

from hashlib import sha256
from typing import Any

from .dependency_safety_contracts import canonical_json

FEATURE_FIELDS = (
    "activation", "architecturalPlane", "audit", "availability", "commitSha",
    "conservativeFallback", "defaultMode", "dependencies", "effects", "emoji", "id",
    "implementation", "implementationVerification", "incompatibilities", "layers", "order",
    "ownerService", "prerequisites", "productAvailability", "remainingGate", "remediation",
    "remoteSha", "supportedOperations", "testCenter", "testableLayers", "title",
)
AUDIT_SNAPSHOT_FIELDS = (
    "audit", "remediation", "implementationVerification", "productAvailability", "testCenter",
)
_LAYER_FIELDS = ("capture", "evaluate", "project", "enforce")
_EFFECT_FIELDS = ("authority", "cost", "persistence", "sideEffects")
RUN_FIELDS = (
    "runId", "operatorTestId", "featureId", "scenarioId", "mode", "repositorySha",
    "registryVersion", "registryHash", "controlHash", "fixtureHash", "safeEnvironment",
    "invariantVerdict", "result", "idempotencyKey", "requestHash", "manualGuard", "liteMode",
    "prerequisiteBindings", "prerequisiteClosureHash", "auditSnapshot", "auditSnapshotHash",
    "events", "frozenInputManifest", "frozenInputManifestHash",
)
_EVENT_FIELDS = ("sequence", "eventType", "status")
_BINDING_FIELDS = ("featureId", "revision", "registryHash", "controlHash")
_PRIVATE_AUDIT_FIELDS = ("finding" + "Counts", "audit" + "TraceId", "audit" + "PackageHash")


def _strings(value: Any) -> list[str]:
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def public_feature(source: dict[str, Any], phase: int) -> dict[str, Any]:
    """Project a registry entry through the immutable public Test Center schema."""
    feature = {key: source[key] for key in FEATURE_FIELDS if key in source}
    feature["order"] = source["order"] if isinstance(source.get("order"), int) else 0
    for key in FEATURE_FIELDS:
        if key not in {"order", "dependencies", "prerequisites", "supportedOperations",
                       "testableLayers", "layers", "effects"}:
            feature[key] = source[key] if isinstance(source.get(key), str) else ""
    for key in ("dependencies", "prerequisites", "supportedOperations", "testableLayers", "incompatibilities"):
        feature[key] = _strings(source.get(key))
    layers = source.get("layers") if isinstance(source.get("layers"), dict) else {}
    feature["layers"] = {key: layers[key] for key in _LAYER_FIELDS if isinstance(layers.get(key), str)}
    effects = source.get("effects") if isinstance(source.get("effects"), dict) else {}
    feature["effects"] = {key: effects[key] for key in _EFFECT_FIELDS if isinstance(effects.get(key), bool)}
    feature["phase"] = phase
    return feature


def public_audit_snapshot(source: dict[str, Any]) -> dict[str, str]:
    return {key: source[key] if isinstance(source.get(key), str) else "" for key in AUDIT_SNAPSHOT_FIELDS}


def _public_json(value: Any) -> Any:
    """Copy bounded public JSON while rejecting the private audit field family at every depth."""
    if isinstance(value, dict):
        return {key: _public_json(item) for key, item in value.items()
                if isinstance(key, str) and key not in _PRIVATE_AUDIT_FIELDS}
    if isinstance(value, list):
        return [_public_json(item) for item in value]
    return value if value is None or isinstance(value, (str, int, bool)) else None


def _public_event(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    return {key: _public_json(source[key]) for key in _EVENT_FIELDS if key in source}


def _public_binding(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    return {key: _public_json(source[key]) for key in _BINDING_FIELDS if key in source}


def public_run_response(payload: dict[str, Any]) -> dict[str, Any]:
    """Narrow historical run responses without rewriting immutable stored rows."""
    response = {key: _public_json(payload[key]) for key in RUN_FIELDS if key in payload}
    snapshot = payload.get("auditSnapshot")
    if isinstance(snapshot, dict):
        safe_snapshot = public_audit_snapshot(snapshot)
        response["auditSnapshot"] = safe_snapshot
        response["auditSnapshotHash"] = sha256(canonical_json(safe_snapshot)).hexdigest()
    if "events" in response:
        response["events"] = [_public_event(item) for item in payload.get("events", [])]
    if "prerequisiteBindings" in response:
        response["prerequisiteBindings"] = [_public_binding(item)
            for item in payload.get("prerequisiteBindings", [])]
    return response
