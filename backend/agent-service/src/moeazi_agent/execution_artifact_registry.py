"""Checked-in registry loader, scope validator, and deterministic DAG closure."""
from __future__ import annotations

import json
from datetime import datetime
from importlib.resources import files

from .execution_artifact_contracts import ArtifactScope, ExecutableArtifactSpec, digest

REGISTRY_FILE = "execution_artifact_registry.json"
REQUIRED_PROFILES = {"uniswap_trading_prepare", "emergency_close", "read_only_reconcile"}
PROFILE_ALIASES = {
    "uniswap_trading_submit": "uniswap_trading_prepare", "uniswap_reconcile": "read_only_reconcile",
}


def _raw() -> dict: return json.loads(files("moeazi_agent").joinpath(REGISTRY_FILE).read_text(encoding="utf-8"))


def specs() -> tuple[ExecutableArtifactSpec, ...]:
    result = []
    for item in _raw()["specs"]:
        body = dict(item)
        for source, target in (("effectiveAt", "effective_at"), ("expiresAt", "expires_at"), ("artifactId", "artifact_id"),
                               ("artifactType", "artifact_type"), ("freshnessSeconds", "freshness_seconds"), ("specHash", "spec_hash")):
            body[target] = body.pop(source)
        body["effective_at"] = datetime.fromisoformat(body["effective_at"].replace("Z", "+00:00"))
        body["expires_at"] = datetime.fromisoformat(body["expires_at"].replace("Z", "+00:00"))
        body["scope"] = ArtifactScope(kind=body.pop("scope"), key=body.pop("scopeKey"))
        result.append(ExecutableArtifactSpec(**body))
    return tuple(result)


def operation_roots() -> dict[str, list[str]]:
    roots = dict(_raw()["operationProfiles"])
    roots.update({name: roots[target] for name, target in PROFILE_ALIASES.items()})
    return roots
def registry_hash() -> str: return digest(_raw())


def closure(operation: str, scope: ArtifactScope) -> tuple[ExecutableArtifactSpec, ...]:
    declared_operation = operation
    operation = PROFILE_ALIASES.get(operation, operation)
    by_id = {item.artifact_id: item for item in specs()}
    roots = operation_roots().get(operation)
    if not roots or len(roots) != len(set(roots)): raise ValueError("Unknown or duplicate artifact operation profile")
    seen, visiting = set(), set()
    def walk(artifact_id: str):
        if artifact_id in visiting: raise ValueError("Artifact registry contains a cycle")
        if artifact_id in seen: return
        item = by_id.get(artifact_id)
        if not item: raise ValueError("Artifact registry dependency is missing")
        if item.scope.kind != "shared" and item.scope != scope: raise ValueError("Artifact registry dependency has wrong scope")
        if operation not in item.operations: raise ValueError("Artifact does not cover operation")
        visiting.add(artifact_id)
        for child in item.dependencies: walk(child)
        visiting.remove(artifact_id); seen.add(artifact_id)
    for root in roots: walk(root)
    return tuple(sorted((by_id[item] for item in seen), key=lambda item: item.artifact_id))


def verify_registry() -> None:
    raw, items, profiles = _raw(), specs(), operation_roots()
    ids = [item.artifact_id for item in items]
    if raw.get("registryVersion") != "2026-08-11.local-v1" or len(ids) != len(set(ids)) or not items: raise ValueError("Artifact registry identity is invalid")
    if not REQUIRED_PROFILES.issubset(profiles): raise ValueError("Artifact registry lacks required profiles")
    all_profile_ids: set[str] = set()
    for operation in sorted(profiles):
        values = closure(operation, ArtifactScope(kind="account", key="account:fixture"))
        if not values: raise ValueError("Artifact profile is empty")
        all_profile_ids.update(item.artifact_id for item in values)
    if set(ids) != all_profile_ids: raise ValueError("Artifact registry has orphan identities")
    main = {item.artifact_id for item in closure("uniswap_trading_prepare", ArtifactScope(kind="account", key="account:fixture"))}
    for safety in ("emergency_close", "read_only_reconcile"):
        if main & {item.artifact_id for item in closure(safety, ArtifactScope(kind="account", key="account:fixture"))}:
            raise ValueError("Safety profile must have an independent root")
