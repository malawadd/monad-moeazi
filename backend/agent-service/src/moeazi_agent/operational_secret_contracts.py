from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from hashlib import sha256
import json
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

from .contracts import StrictModel

Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
OpaqueId = Annotated[str, Field(pattern=r"^[a-z]{2,8}_[a-f0-9]{24,64}$")]


def canonical_json(value: Any) -> bytes:
    def reject(item: Any) -> None:
        if isinstance(item, float):
            raise ValueError("Operational secret contracts prohibit floating-point values")
        if isinstance(item, BaseModel):
            reject(item.model_dump(mode="json", exclude_none=False))
        elif isinstance(item, dict):
            for key, nested in item.items():
                if not isinstance(key, str):
                    raise ValueError("Canonical object keys must be strings")
                reject(nested)
        elif isinstance(item, (list, tuple)):
            for nested in item:
                reject(nested)
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json", exclude_none=False)
    def normalize(item: Any) -> Any:
        if isinstance(item, datetime):
            if item.tzinfo is None or item.utcoffset() is None or item.utcoffset().total_seconds() != 0:
                raise ValueError("Canonical timestamps must be UTC")
            return item.isoformat().replace("+00:00", "Z")
        if isinstance(item, dict): return {key: normalize(nested) for key, nested in item.items()}
        if isinstance(item, (list, tuple)): return [normalize(nested) for nested in item]
        return item
    reject(value)
    value = normalize(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(value: Any) -> str:
    return sha256(canonical_json(value)).hexdigest()


class SecretModel(StrictModel):
    @model_validator(mode="before")
    @classmethod
    def strict_values(cls, value: Any):
        def reject_floats(item: Any) -> None:
            if isinstance(item, float):
                raise ValueError("Operational secret contracts prohibit floating-point values")
            if isinstance(item, dict):
                for nested in item.values(): reject_floats(nested)
            elif isinstance(item, (list, tuple)):
                for nested in item: reject_floats(nested)
        reject_floats(value)
        return value

    @model_validator(mode="after")
    def utc_only(self):
        def check(value: Any) -> None:
            if isinstance(value, datetime) and (value.tzinfo is None or value.utcoffset() is None
                    or value.utcoffset().total_seconds() != 0):
                raise ValueError("Operational secret timestamps must be UTC")
            if isinstance(value, BaseModel):
                check(value.__dict__)
            elif isinstance(value, dict):
                for nested in value.values(): check(nested)
            elif isinstance(value, (list, tuple)):
                for nested in value: check(nested)
        check(self)
        return self

    @model_validator(mode="after")
    def canonical_identity_hashes(self):
        """Reject forged identity hashes; referenced policy/AAD hashes stay external bindings."""
        names = {"OperationalSecretDescriptor": "descriptor_hash",
            "SecretAccessRequest": "request_hash", "SecretAccessDecision": "decision_hash",
            "SecretAccessReceipt": "receipt_hash"}
        name = names.get(type(self).__name__)
        if name:
            body = self.model_dump(mode="python", exclude={name})
            if getattr(self, name) != digest(body):
                raise ValueError(f"Operational secret {name} is not canonical")
        return self


class RecoveryMode(StrEnum):
    REENTER = "reenter"
    REISSUE = "reissue"
    REPLACE = "replace"
    REWRAP = "rewrap"
    RESTORE_ACCESS = "restore_access"
    FORBIDDEN = "forbidden"


SecretClass = Literal[
    "model_provider_byok", "platform_provider_credential", "external_data_credential",
    "restricted_venue_api_credential", "internal_service_auth", "infrastructure_credential",
    "restricted_venue_delegate_key", "vault_data_key", "vault_access_binding",
    "owner_auth_material",
]
Purpose = Literal["provider_call", "market_data_read", "venue_api_call", "service_auth",
                  "infrastructure_access", "key_rewrap", "access_restore"]
Capability = Literal["invoke_provider", "read_external_data", "invoke_venue_api",
                     "authenticate_service", "access_infrastructure", "rewrap_key",
                     "restore_binding"]
ReasonCode = Literal[
    "authorized", "completed", "wrong_tenant", "class_mismatch", "source_mismatch", "purpose_mismatch",
    "consumer_mismatch", "capability_mismatch", "version_mismatch", "policy_drift",
    "aad_mismatch", "ciphertext_invalid", "stale_decision", "reference_reused",
    "descriptor_disabled", "kek_unavailable", "receipt_persistence_failed",
    "owner_material_forbidden", "recovery_widened", "owner_approval_missing",
    "replacement_unverified", "predecessor_conflict", "upstream_unknown",
    "inventory_incomplete", "reviewer_quorum_missing", "migration_quarantined",
    "ready", "product_unavailable", "simulated_local",
]


class SecretClassPolicy(SecretModel):
    schema_version: Literal[1] = 1
    class_id: SecretClass
    allowed_sources: list[Literal["user_reentry", "platform_config", "external_system",
                                  "execution_boundary", "vault_internal", "forbidden"]]
    workload_identities: list[str] = Field(max_length=8)
    purposes: list[Purpose] = Field(max_length=8)
    capabilities: list[Capability] = Field(max_length=8)
    recovery_mode: RecoveryMode
    access_ttl_seconds: int = Field(ge=1, le=900)
    rotation_grace_seconds: int = Field(ge=0, le=86400)
    revocation_evidence_ceiling: Literal["unknown", "provider_reported"]
    migration_disposition: Literal["reenter", "reissue", "replace", "rewrap", "restore_access", "forbidden"]
    owner_material_rule: Literal["reject", "not_owner_material"]
    version: Literal[1] = 1
    policy_hash: Hash


class OperationalSecretDescriptor(SecretModel):
    schema_version: Literal[1] = 1
    descriptor_id: OpaqueId
    tenant_scope: str = Field(pattern=r"^tenant_[a-f0-9]{16}:account_[a-f0-9]{16}$")
    class_id: SecretClass
    source_owner: Literal["user", "platform", "external_system", "vault"]
    state: Literal["active", "disabled", "rotating", "revoked", "destroyed"]
    envelope_version: int = Field(ge=1)
    data_key_version: int = Field(ge=1)
    kek_version: int = Field(ge=1)
    policy_hash: Hash
    workload_registry_hash: Hash
    creation_revision: int = Field(ge=1)
    descriptor_hash: Hash


class SecretHandle(SecretModel):
    schema_version: Literal[1] = 1
    descriptor_id: OpaqueId
    envelope_version: int = Field(ge=1)


class WrappedSecretEnvelope(SecretModel):
    schema_version: Literal[1] = 1
    descriptor_id: OpaqueId
    tenant_scope: str
    class_id: SecretClass
    policy_hash: Hash
    envelope_version: int = Field(ge=1)
    data_key_version: int = Field(ge=1)
    kek_version: int = Field(ge=1)
    algorithm: Literal["AES-256-GCM"] = "AES-256-GCM"
    wrap_algorithm: Literal["AES-256-GCM"] = "AES-256-GCM"
    ciphertext: bytes
    wrapped_dek: bytes
    data_nonce: bytes = Field(min_length=12, max_length=12)
    wrap_nonce: bytes = Field(min_length=12, max_length=12)
    aad_hash: Hash
    state: Literal["active", "disabled", "superseded", "destroyed"]
    expires_at: datetime


class SecretAccessRequest(SecretModel):
    schema_version: Literal[1] = 1
    tenant_scope: str
    descriptor_id: OpaqueId
    class_id: SecretClass
    purpose: Purpose
    consumer_id: str = Field(pattern=r"^[a-z][a-z0-9_]{2,63}$")
    consumer_version: str = Field(pattern=r"^v[1-9][0-9]*$")
    capability: Capability
    envelope_version: int = Field(ge=1)
    aad_hash: Hash
    policy_hash: Hash
    request_hash: Hash
    idempotency_key: str = Field(min_length=8, max_length=96, pattern=r"^[A-Za-z0-9._:-]+$")
    requested_at: datetime


class SecretAccessDecision(SecretModel):
    schema_version: Literal[1] = 1
    decision_id: OpaqueId
    tenant_scope: str
    descriptor_id: OpaqueId
    class_id: SecretClass
    purpose: Purpose
    consumer_id: str
    consumer_version: str
    capability: Capability
    envelope_version: int = Field(ge=1)
    aad_hash: Hash
    request_hash: Hash
    descriptor_hash: Hash
    envelope_hash: Hash
    policy_hash: Hash
    workload_registry_hash: Hash
    outcome: Literal["allow", "block"]
    reasons: list[ReasonCode] = Field(min_length=1, max_length=12)
    decided_at: datetime
    expires_at: datetime
    decision_hash: Hash


class SecretAccessReceipt(SecretModel):
    schema_version: Literal[1] = 1
    receipt_id: OpaqueId
    tenant_scope: str
    descriptor_id: OpaqueId
    class_id: SecretClass
    purpose: Purpose
    consumer_id: str
    consumer_version: str
    capability: Capability
    envelope_version: int = Field(ge=1)
    aad_hash: Hash
    policy_hash: Hash
    decision_hash: Hash
    request_hash: Hash
    idempotency_key: str
    stage: Literal["authorized_attempt", "terminal"]
    outcome: Literal["authorized", "completed", "blocked", "callback_failed"]
    reason: ReasonCode
    sequence: Literal[1, 2]
    occurred_at: datetime
    receipt_hash: Hash

    @model_validator(mode="after")
    def correlated_stage(self):
        valid = {
            ("authorized_attempt", "authorized", "authorized", 1),
            ("terminal", "completed", "completed", 2),
            ("terminal", "callback_failed", "ciphertext_invalid", 2),
            ("terminal", "blocked", "receipt_persistence_failed", 2),
        }
        if (self.stage, self.outcome, self.reason, self.sequence) not in valid:
            raise ValueError("Operational secret receipt stage is invalid")
        return self


def with_hash(model: type[SecretModel], hash_field: str, **body: Any):
    return model(**body, **{hash_field: digest(body)})
