from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

from .contracts import StrictModel
from .evidence_lifecycle_identity import canonical_lifecycle_scope_key

Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
ScopeKey = Annotated[str, Field(pattern=r"^(public|account:[^:]{1,120}|tenant:[^:]{1,120})$")]
ReasonCode = Literal[
    "allowed", "transformed", "prohibited_content", "unknown_field", "unknown_sink",
    "unknown_producer", "unknown_purpose", "scope_mismatch", "invalid_payload",
    "missing_safety_root", "policy_stale", "retention_due", "hold_active",
    "copy_pending", "copy_unverifiable", "public_onchain_non_erasable",
    "deleted_body", "inventory_unknown", "projection_failed", "legacy_unclassified",
]


class DataElementClass(StrEnum):
    PROHIBITED = "prohibited"
    SECRET = "secret"
    PERSONAL = "personal"
    LINKABLE = "linkable"
    FINANCIAL = "financial"
    CUSTOMER_CONFIDENTIAL = "customer_confidential"
    INTERNAL = "internal"
    PUBLIC = "public"
    SAFETY_ROOT = "safety_root"


class LifecycleScope(StrictModel):
    kind: Literal["public", "tenant", "account"]
    key: str = Field(min_length=1, max_length=180)
    tenant_id: str | None = Field(default=None, max_length=120)
    strategy_account_id: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def canonical(self):
        if self.kind == "public": expected = "public"
        elif self.kind == "tenant" and self.tenant_id:
            expected = f"tenant:{self.tenant_id}"
        elif self.kind == "account" and self.strategy_account_id:
            expected = f"account:{self.strategy_account_id}"
        else:
            raise ValueError("Lifecycle scope is missing its registry-owned identifier")
        if self.key != expected:
            raise ValueError(f"Lifecycle scope key is not canonical; expected {expected}")
        canonical_lifecycle_scope_key(self.key)
        if self.kind != "tenant" and self.tenant_id is not None:
            raise ValueError("Only tenant scope may contain tenant_id")
        if self.kind != "account" and self.strategy_account_id is not None:
            raise ValueError("Only account scope may contain strategy_account_id")
        return self


class LifecycleModel(StrictModel):
    @model_validator(mode="before")
    @classmethod
    def no_floats(cls, value):
        def visit(item):
            if isinstance(item, float): raise ValueError("Lifecycle contracts prohibit floats")
            if isinstance(item, dict):
                for nested in item.values(): visit(nested)
            elif isinstance(item, (list, tuple)):
                for nested in item: visit(nested)
        visit(value)
        return value

    @model_validator(mode="after")
    def utc_times(self):
        def visit(item):
            if isinstance(item, datetime) and (item.tzinfo is None or item.utcoffset() is None
                    or item.utcoffset().total_seconds() != 0):
                raise ValueError("Lifecycle timestamps must be UTC")
            if isinstance(item, BaseModel): item = item.__dict__
            if isinstance(item, dict):
                for nested in item.values(): visit(nested)
            elif isinstance(item, (list, tuple)):
                for nested in item: visit(nested)
        visit(self)
        return self


class DataHandlingPolicy(LifecycleModel):
    schema_version: Literal[1] = 1
    producer: str = Field(pattern=r"^[a-z0-9_]{3,64}$")
    purpose: str = Field(pattern=r"^[a-z0-9_]{3,64}$")
    sink: str = Field(pattern=r"^[a-z0-9_.]{3,96}$")
    allowed_paths: dict[str, DataElementClass]
    transforms: dict[str, Literal["retain", "drop", "truncate", "normalize"]]
    retention_seconds: int = Field(ge=0, le=31_536_000)
    expected_copies: list[str] = Field(min_length=1, max_length=12)
    policy_version: str = Field(min_length=8, max_length=80)
    inventory_hash: Hash
    policy_hash: Hash


class RetentionSchedule(LifecycleModel):
    schedule_id: str = Field(pattern=r"^ers_[a-f0-9]{48}$")
    artifact_id: str = Field(min_length=8, max_length=120)
    scope_key: ScopeKey = "public"
    body_expires_at: datetime
    minimal_safety_paths: list[str] = Field(min_length=1, max_length=20)
    expected_copies: list[str] = Field(min_length=1, max_length=12)
    policy_hash: Hash
    schedule_hash: Hash


class TransformReceipt(LifecycleModel):
    receipt_id: str = Field(pattern=r"^etr_[a-f0-9]{48}$")
    decision_id: str = Field(pattern=r"^eld_[a-f0-9]{48}$")
    processor: str = Field(pattern=r"^[a-z0-9_]{3,64}$")
    processor_version: str = Field(min_length=3, max_length=40)
    path: str = Field(min_length=1, max_length=180)
    data_class: DataElementClass
    outcome: Literal["retained", "dropped", "normalized", "truncated"]
    sanitized_output_hash: Hash
    receipt_hash: Hash


class PersistenceDecision(LifecycleModel):
    schema_version: Literal[1] = 1
    decision_id: str = Field(pattern=r"^eld_[a-f0-9]{48}$")
    producer: str = Field(pattern=r"^[a-z0-9_]{3,64}$")
    purpose: str = Field(pattern=r"^[a-z0-9_]{3,64}$")
    sink: str = Field(pattern=r"^[a-z0-9_.]{3,96}$")
    scope: LifecycleScope
    input_digest: Hash
    sanitized_payload_hash: Hash | None
    policy_hash: Hash
    inventory_hash: Hash
    outcome: Literal["allow", "transformed", "drop", "quarantine", "block", "unknown"]
    reasons: list[ReasonCode] = Field(min_length=1, max_length=12)
    allowed_paths: list[str] = Field(max_length=64)
    transform_receipt_hashes: list[Hash] = Field(max_length=64)
    retention_schedule_hash: Hash | None
    idempotency_key: str = Field(min_length=8, max_length=120, pattern=r"^[A-Za-z0-9._:-]+$")
    evaluated_at: datetime
    expires_at: datetime
    decision_hash: Hash

    @model_validator(mode="after")
    def coherent(self):
        if self.expires_at <= self.evaluated_at:
            raise ValueError("Lifecycle decision expiry must follow evaluation")
        if self.outcome in {"allow", "transformed"} and not self.sanitized_payload_hash:
            raise ValueError("Permitted lifecycle decisions require sanitized payload binding")
        if self.outcome not in {"allow", "transformed"} and self.allowed_paths:
            raise ValueError("Blocked lifecycle decision cannot expose allowed paths")
        if len(set(self.transform_receipt_hashes)) != len(self.transform_receipt_hashes):
            raise ValueError("Transform receipt bindings must be unique")
        return self


class LifecycleHold(LifecycleModel):
    hold_id: str = Field(pattern=r"^elh_[a-f0-9]{48}$")
    artifact_id: str = Field(min_length=8, max_length=120)
    scope_key: ScopeKey = "public"
    reason_code: Literal["safety_investigation", "customer_contestation", "legal_review"]
    reviewer_hash: Hash
    starts_at: datetime
    expires_at: datetime
    max_expires_at: datetime
    revision: int = Field(ge=1)
    supersedes_hold_hash: Hash | None
    hold_hash: Hash

    @model_validator(mode="after")
    def bounded(self):
        if not self.starts_at < self.expires_at <= self.max_expires_at:
            raise ValueError("Lifecycle hold must be explicitly bounded")
        return self


CopyStatus = Literal["verified_logical", "verified_physical", "crypto_erased",
    "retained_hold", "provider_reported", "pending", "partial", "unverifiable",
    "public_onchain", "not_applicable"]


class CopyDispositionReceipt(LifecycleModel):
    receipt_id: str = Field(pattern=r"^ecd_[a-f0-9]{48}$")
    artifact_id: str = Field(min_length=8, max_length=120)
    scope_key: ScopeKey = "public"
    schedule_hash: Hash
    copy_id: str = Field(pattern=r"^[a-z0-9_.:-]{3,96}$")
    owner_id: str = Field(pattern=r"^[a-z0-9_]{3,64}$")
    revision: int = Field(ge=1)
    predecessor_hash: Hash | None
    status: CopyStatus
    evidence_reference: str | None = Field(default=None, max_length=180)
    observed_at: datetime
    receipt_hash: Hash


class DeletionReceipt(LifecycleModel):
    receipt_id: str = Field(pattern=r"^edr_[a-f0-9]{48}$")
    artifact_id: str = Field(min_length=8, max_length=120)
    scope_key: ScopeKey = "public"
    schedule_hash: Hash
    expected_copies: list[str] = Field(min_length=1, max_length=12)
    policy_hash: Hash
    inventory_hash: Hash
    copy_receipt_hashes: dict[str, Hash]
    outcome: Literal["verified", "partial", "blocked", "unverifiable"]
    reason_codes: list[ReasonCode] = Field(min_length=1, max_length=12)
    evaluated_at: datetime
    receipt_hash: Hash


class AccessReceipt(LifecycleModel):
    receipt_id: str = Field(pattern=r"^ear_[a-f0-9]{48}$")
    artifact_id: str = Field(min_length=8, max_length=120)
    scope: LifecycleScope
    viewer_hash: Hash
    purpose: str = Field(pattern=r"^[a-z0-9_]{3,64}$")
    decision_hash: Hash
    request_hash: Hash
    idempotency_key: str = Field(min_length=8, max_length=120,
        pattern=r"^[A-Za-z0-9._:-]+$")
    output_hash: Hash | None
    outcome: Literal["allow", "block", "unknown"]
    reason_codes: list[ReasonCode] = Field(min_length=1, max_length=8)
    accessed_at: datetime
    receipt_hash: Hash


class ExportReceipt(LifecycleModel):
    receipt_id: str = Field(pattern=r"^eer_[a-f0-9]{48}$")
    artifact_id: str = Field(min_length=8, max_length=120)
    scope: LifecycleScope
    sink: str = Field(pattern=r"^[a-z0-9_.]{3,96}$")
    decision_hash: Hash
    request_hash: Hash
    idempotency_key: str = Field(min_length=8, max_length=120,
        pattern=r"^[A-Za-z0-9._:-]+$")
    expected_copies: list[str] = Field(min_length=1, max_length=12)
    output_hash: Hash | None
    outcome: Literal["transformed", "block", "unknown"]
    reason_codes: list[ReasonCode] = Field(min_length=1, max_length=8)
    exported_at: datetime
    receipt_hash: Hash
