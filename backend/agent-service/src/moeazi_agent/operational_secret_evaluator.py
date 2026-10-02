from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from .operational_secret_contracts import (
    OperationalSecretDescriptor, SecretAccessDecision, SecretAccessRequest,
    SecretClassPolicy, digest, with_hash,
)
from .operational_secret_lifecycle_contracts import LegacyDisposition, LegacyInventoryItem, RecoveryRequest
from .operational_secret_registry import policy_for, workload_registry_hash, workloads

OWNER_FIELDS = {"private_key", "seed", "recovery_phrase", "reusable_signature", "fallback_key",
                "master_key", "execution_key", "owner_key"}
FORBIDDEN_METADATA = {"ciphertext", "wrapped_key", "nonce", "aad", "secret_ref", "subject",
                      "address", "last_four", "fingerprint", "value"}
SOURCE_OWNER = {"user": "user_reentry", "platform": "platform_config",
                "external_system": "external_system", "vault": "vault_internal"}


def envelope_metadata(descriptor: OperationalSecretDescriptor, expires_at: datetime) -> dict:
    return {"schemaVersion": 1, "tenantScope": descriptor.tenant_scope,
        "descriptorId": descriptor.descriptor_id, "classId": descriptor.class_id,
        "policyHash": descriptor.policy_hash, "envelopeVersion": descriptor.envelope_version,
        "dataKeyVersion": descriptor.data_key_version, "kekVersion": descriptor.kek_version,
        "expiresAt": expires_at.isoformat().replace("+00:00", "Z")}


def evaluate_access(request: SecretAccessRequest, descriptor: OperationalSecretDescriptor,
        policy: SecretClassPolicy, envelope_hash: str, now: datetime) -> SecretAccessDecision:
    reasons = []
    if request.descriptor_id != descriptor.descriptor_id: reasons.append("descriptor_disabled")
    if request.tenant_scope != descriptor.tenant_scope: reasons.append("wrong_tenant")
    if request.class_id != descriptor.class_id: reasons.append("class_mismatch")
    if SOURCE_OWNER[descriptor.source_owner] not in policy.allowed_sources: reasons.append("source_mismatch")
    if request.purpose not in policy.purposes: reasons.append("purpose_mismatch")
    identity = f"{request.consumer_id}:{request.consumer_version}"
    if identity not in policy.workload_identities or (request.consumer_id, request.consumer_version) not in workloads():
        reasons.append("consumer_mismatch")
    if request.capability not in policy.capabilities: reasons.append("capability_mismatch")
    if request.envelope_version != descriptor.envelope_version: reasons.append("version_mismatch")
    if request.policy_hash != policy.policy_hash or descriptor.policy_hash != policy.policy_hash:
        reasons.append("policy_drift")
    if descriptor.workload_registry_hash != workload_registry_hash(): reasons.append("policy_drift")
    if descriptor.state != "active": reasons.append("descriptor_disabled")
    outcome = "block" if reasons else "allow"
    if not reasons: reasons = ["authorized"]
    body = {"schema_version": 1, "decision_id": f"osd_{digest({'request': request.request_hash})[:48]}",
        "tenant_scope": request.tenant_scope, "descriptor_id": request.descriptor_id,
        "class_id": request.class_id, "purpose": request.purpose,
        "consumer_id": request.consumer_id, "consumer_version": request.consumer_version,
        "capability": request.capability, "envelope_version": request.envelope_version,
        "aad_hash": request.aad_hash,
        "request_hash": request.request_hash, "descriptor_hash": descriptor.descriptor_hash,
        "envelope_hash": envelope_hash, "policy_hash": policy.policy_hash,
        "workload_registry_hash": workload_registry_hash(), "outcome": outcome,
        "reasons": reasons, "decided_at": now,
        "expires_at": now + timedelta(seconds=policy.access_ttl_seconds)}
    return with_hash(SecretAccessDecision, "decision_hash", **body)


def recovery_is_subset(request: RecoveryRequest, policy: SecretClassPolicy) -> bool:
    return (request.mode == policy.recovery_mode
        and set(request.consumers).issubset(policy.workload_identities)
        and set(request.purposes).issubset(policy.purposes)
        and set(request.capabilities).issubset(policy.capabilities)
        and request.duration_seconds <= policy.access_ttl_seconds)


def evaluate_recovery(request: RecoveryRequest, class_id: str) -> tuple[str, str]:
    policy = policy_for(class_id)
    if policy.recovery_mode.value == "forbidden": return "blocked", "owner_material_forbidden"
    if not recovery_is_subset(request, policy): return "blocked", "recovery_widened"
    if policy.recovery_mode.value == "replace" and request.owner_approval_hash is None:
        return "blocked", "owner_approval_missing"
    return {"reenter": "reentered", "reissue": "reissued", "replace": "replaced",
            "rewrap": "rewrapped", "restore_access": "access_restored"}[policy.recovery_mode.value], "completed"


def classify_legacy(item: LegacyInventoryItem) -> LegacyDisposition:
    lowered = {field.lower() for field in item.fields}
    if lowered & FORBIDDEN_METADATA:
        raise ValueError("Legacy classifier accepts metadata shape only")
    inventory_hash = digest(item)
    if lowered & OWNER_FIELDS or item.table == "walletSecrets":
        disposition, reason = "quarantine_owner_equivalent", "owner_material_forbidden"
    elif item.version is None:
        disposition, reason = "quarantine_unknown", "migration_quarantined"
    elif item.table == "provider_secrets":
        disposition, reason = "eligible_pending_reentry", "completed"
    elif item.table == "venueCredentials":
        disposition, reason = "eligible_pending_reissue", "completed"
    elif "wrapping_version" in lowered:
        disposition, reason = "eligible_pending_rewrap", "completed"
    else:
        disposition, reason = "quarantine_unknown", "migration_quarantined"
    return LegacyDisposition(fixture_id=item.fixture_id, disposition=disposition,
        capability_status="disabled" if disposition.startswith("quarantine") else "unchanged",
        reason=reason, inventory_hash=inventory_hash)
