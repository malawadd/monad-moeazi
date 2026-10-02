from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from .operational_secret_contracts import Hash, OpaqueId, ReasonCode, RecoveryMode, SecretModel


class RotationPlan(SecretModel):
    plan_id: OpaqueId
    descriptor_id: OpaqueId
    predecessor_envelope_version: int = Field(ge=1)
    target_envelope_version: int = Field(ge=2)
    target_data_key_version: int = Field(ge=1)
    target_kek_version: int = Field(ge=1)
    replacement_proof_hash: Hash | None = None
    idempotency_key: str = Field(min_length=8, max_length=96)
    plan_hash: Hash


class RotationReceipt(SecretModel):
    receipt_id: OpaqueId
    plan_hash: Hash
    state: Literal["planned", "replacement_stored", "replacement_verified", "cutover",
                   "old_revoke_requested", "complete", "incomplete"]
    predecessor_hash: Hash | None = None
    local_status: Literal["active", "disabled"]
    upstream_status: Literal["unknown", "provider_reported"]
    reason: ReasonCode
    occurred_at: datetime
    receipt_hash: Hash


class RecoveryRequest(SecretModel):
    request_id: OpaqueId
    descriptor_id: OpaqueId
    mode: RecoveryMode
    tenant_scope: str
    consumers: list[str] = Field(max_length=8)
    purposes: list[str] = Field(max_length=8)
    capabilities: list[str] = Field(max_length=8)
    duration_seconds: int = Field(ge=1, le=900)
    owner_approval_hash: Hash | None = None
    idempotency_key: str = Field(min_length=8, max_length=96)
    request_hash: Hash


class RecoveryReceipt(SecretModel):
    receipt_id: OpaqueId
    request_hash: Hash
    outcome: Literal["reentered", "reissued", "replaced", "rewrapped", "access_restored", "blocked"]
    local_status: Literal["active", "disabled"]
    upstream_status: Literal["unknown", "provider_reported"]
    reason: ReasonCode
    occurred_at: datetime
    receipt_hash: Hash


class RevocationReceipt(SecretModel):
    receipt_id: OpaqueId
    descriptor_id: OpaqueId
    local_status: Literal["disabled"] = "disabled"
    upstream_status: Literal["unknown", "provider_reported"]
    reason: Literal["upstream_unknown", "completed"]
    occurred_at: datetime
    receipt_hash: Hash


class DestructionPlan(SecretModel):
    plan_id: OpaqueId
    descriptor_id: OpaqueId
    descriptor_hash: Hash
    envelope_hashes: list[Hash] = Field(min_length=1, max_length=32)
    dependency_hashes: list[Hash] = Field(min_length=1, max_length=32)
    reviewer_ids: list[str] = Field(min_length=2, max_length=2)
    plan_hash: Hash

    @model_validator(mode="after")
    def distinct_reviewers(self):
        if len(set(self.reviewer_ids)) != 2:
            raise ValueError("Destruction requires two distinct synthetic reviewers")
        return self


class DestructionReceipt(SecretModel):
    receipt_id: OpaqueId
    plan_hash: Hash
    outcome: Literal["simulated_local", "blocked"]
    reason: ReasonCode
    occurred_at: datetime
    receipt_hash: Hash


class LifecycleDecision(SecretModel):
    decision_id: OpaqueId
    operation: Literal["inventory", "admit", "access", "rotate", "recover", "revoke",
                       "destroy_plan", "readiness_assess", "migration_classify"]
    descriptor_id: OpaqueId | None = None
    predecessor_hashes: list[Hash] = Field(max_length=32)
    outcome: Literal["allow", "block", "incomplete"]
    reasons: list[ReasonCode] = Field(min_length=1, max_length=16)
    idempotency_key: str = Field(min_length=8, max_length=96)
    occurred_at: datetime
    decision_hash: Hash


class CustodyReadinessAssessment(SecretModel):
    assessment_id: OpaqueId
    tenant_scope: str
    registry_hash: Hash
    dependency_hashes: list[Hash] = Field(min_length=3, max_length=3)
    inventory_hash: Hash
    receipt_chain_hash: Hash
    local_fixture_outcome: Literal["ready", "blocked"]
    product_outcome: Literal["unavailable"] = "unavailable"
    reasons: list[ReasonCode] = Field(min_length=1, max_length=16)
    assessed_at: datetime
    assessment_hash: Hash


class LegacyInventoryItem(SecretModel):
    fixture_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,79}$")
    store: Literal["timescale", "convex", "environment"]
    table: str | None = Field(default=None, max_length=64)
    fields: list[str] = Field(max_length=16)
    source: str = Field(max_length=64)
    caller: str = Field(max_length=96)
    role: str = Field(max_length=64)
    status: str = Field(max_length=32)
    version: int | None = Field(default=None, ge=1)


class LegacyDisposition(SecretModel):
    fixture_id: str
    disposition: Literal["eligible_pending_reentry", "eligible_pending_reissue",
                         "eligible_pending_rewrap", "quarantine_owner_equivalent",
                         "quarantine_unknown", "forbidden"]
    capability_status: Literal["disabled", "unchanged"]
    reason: ReasonCode
    inventory_hash: Hash
