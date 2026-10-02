from __future__ import annotations

import json
from importlib.resources import files

from .operational_secret_contracts import SecretClassPolicy, digest

REGISTRY_FILE = "operational_secret_registry.json"


def _load() -> dict:
    return json.loads(files("moeazi_agent").joinpath(REGISTRY_FILE).read_text(encoding="utf-8"))


def class_policies() -> tuple[SecretClassPolicy, ...]:
    result = []
    for item in _load()["classes"]:
        body = {
            "schema_version": 1, "class_id": item["classId"],
            "allowed_sources": item["allowedSources"],
            "workload_identities": item["workloadIdentities"],
            "purposes": item["purposes"], "capabilities": item["capabilities"],
            "recovery_mode": item["recoveryMode"],
            "access_ttl_seconds": item["accessTtlSeconds"],
            "rotation_grace_seconds": item["rotationGraceSeconds"],
            "revocation_evidence_ceiling": item["revocationEvidenceCeiling"],
            "migration_disposition": item["migrationDisposition"],
            "owner_material_rule": item["ownerMaterialRule"], "version": 1,
        }
        result.append(SecretClassPolicy(**body, policy_hash=digest(body)))
    return tuple(result)


def workloads() -> tuple[tuple[str, str], ...]:
    return tuple((item["consumerId"], item["version"]) for item in _load()["workloads"])


def workload_registry_hash() -> str:
    body = _load()
    return digest({"schemaVersion": body["schemaVersion"], "workloads": body["workloads"],
                   "deniedConsumers": sorted(body["deniedConsumers"])})


def registry_hash() -> str:
    return digest({"registryVersion": _load()["registryVersion"],
                   "policies": [item.model_dump(mode="json") for item in class_policies()],
                   "workloadRegistryHash": workload_registry_hash()})


def policy_for(class_id: str) -> SecretClassPolicy:
    policy = next((item for item in class_policies() if item.class_id == class_id), None)
    if not policy:
        raise ValueError("Unknown operational secret class")
    return policy


def verify_registry() -> None:
    expected = {"model_provider_byok": "reenter", "platform_provider_credential": "reissue",
        "external_data_credential": "reissue", "restricted_venue_api_credential": "reissue",
        "internal_service_auth": "reissue", "infrastructure_credential": "reissue",
        "restricted_venue_delegate_key": "replace", "vault_data_key": "rewrap",
        "vault_access_binding": "restore_access", "owner_auth_material": "forbidden"}
    policies = class_policies()
    if {item.class_id: item.recovery_mode.value for item in policies} != expected:
        raise ValueError("Operational secret recovery registry is incomplete")
    if any(identity in {"browser", "model", "temporal_workflow", "redis", "ui"}
           for identity, _ in workloads()):
        raise ValueError("Prohibited workload admitted")
    if len({item.policy_hash for item in policies}) != len(policies):
        raise ValueError("Operational secret policy hashes must be unique")


def registry_response() -> dict:
    verify_registry()
    body = _load()
    return {"schemaVersion": 1, "registryVersion": body["registryVersion"],
        "registryHash": registry_hash(), "workloadRegistryHash": workload_registry_hash(),
        "classes": [item.model_dump(mode="json") for item in class_policies()],
        "workloads": [{"consumerId": item[0], "version": item[1]} for item in workloads()]}
