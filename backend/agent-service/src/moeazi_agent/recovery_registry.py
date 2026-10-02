from __future__ import annotations

from functools import lru_cache

from .dependency_safety_contracts import digest
from .recovery_contracts import DomainId, READINESS_TTL_SECONDS, RecoveryDomainPolicy

REGISTRY_VERSION = "recovery-domains-v1"
DOMAIN_IDS: tuple[DomainId, ...] = (
    "convex_product_state", "timescale_history", "temporal_workflows",
    "repository_release", "redis_coordination", "external_execution_state",
    "non_owner_secret_custody",
)

_POLICIES = (
    ("convex_product_state", "convex", "critical", "native_isolated_restore",
     ["native_export", "schema_revision", "record_checksum"], 3600, 7200, True, "block"),
    ("timescale_history", "timescale", "critical", "logical_isolated_restore",
     ["logical_backup", "migration_revision", "record_checksum"], 3600, 7200, True, "block"),
    ("temporal_workflows", "temporal", "critical", "restore_then_reconcile",
     ["workflow_history", "schedule_manifest", "namespace_revision"], 3600, 10800, True, "block"),
    ("repository_release", "repository", "critical", "exact_manifest",
     ["repository_revision", "migration_manifest", "configuration_manifest"], 0, 900, True, "block"),
    ("redis_coordination", "redis", "critical", "empty_rebuild",
     ["empty_start", "durable_owner_rebuild", "reconstruction_checksum"], 0, 900, False, "block"),
    ("external_execution_state", "execution_reconciliation", "required_read_only",
     "authoritative_reconcile", ["submission_terminality", "nonce_state", "uncertainty_bounds"],
     None, None, True, "block"),
    ("non_owner_secret_custody", "secret_custody", "required_read_only", "future_owner",
     ["custody_revision", "availability_attestation"], None, None, True, "block"),
)


def _policy(values: tuple) -> RecoveryDomainPolicy:
    domain, owner, criticality, method, kinds, rpo, rto, independent, omission = values
    body = {
        "schema_version": 1, "domain_id": domain, "owner": owner,
        "criticality": criticality, "method": method, "evidence_kinds": kinds,
        "rpo_target_seconds": rpo, "read_only_rto_target_seconds": rto,
        "independent_proof_required": independent, "omission_behavior": omission,
    }
    return RecoveryDomainPolicy(**body, policy_hash=digest(body))


@lru_cache(maxsize=1)
def domain_policies() -> tuple[RecoveryDomainPolicy, ...]:
    return tuple(_policy(item) for item in _POLICIES)


@lru_cache(maxsize=1)
def registry_hash() -> str:
    return digest({"version": REGISTRY_VERSION,
        "policies": [item.model_dump(mode="json") for item in domain_policies()]})


def verify_registry() -> None:
    policies = domain_policies()
    if tuple(item.domain_id for item in policies) != DOMAIN_IDS:
        raise ValueError("Recovery registry domain coverage is invalid")
    if len({item.policy_hash for item in policies}) != len(DOMAIN_IDS):
        raise ValueError("Recovery registry policy hashes are not unique")
    for policy in policies:
        body = policy.model_dump(mode="python"); actual = body.pop("policy_hash")
        if actual != digest(body):
            raise ValueError("Recovery registry policy hash is invalid")


def registry_response() -> dict:
    verify_registry()
    return {"registryVersion": REGISTRY_VERSION, "registryHash": registry_hash(),
        "readinessTtlSeconds": READINESS_TTL_SECONDS,
        "domains": [item.model_dump(mode="json") for item in domain_policies()]}
