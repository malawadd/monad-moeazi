from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

from .contracts import StrictModel

Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Sha40 = Annotated[str, Field(pattern=r"^[a-f0-9]{40}$")]
READINESS_TTL_SECONDS = 900
EvidenceKind = Literal[
    "native_export", "schema_revision", "record_checksum", "logical_backup",
    "migration_revision", "workflow_history", "schedule_manifest", "namespace_revision",
    "repository_revision", "migration_manifest", "configuration_manifest", "empty_start",
    "durable_owner_rebuild", "reconstruction_checksum", "submission_terminality",
    "nonce_state", "uncertainty_bounds", "custody_revision", "availability_attestation",
]
DomainId = Literal[
    "convex_product_state", "timescale_history", "temporal_workflows",
    "repository_release", "redis_coordination", "external_execution_state",
    "non_owner_secret_custody",
]
ReasonCode = Literal[
    "verified", "evidence_missing", "evidence_unverified", "checksum_mismatch",
    "count_mismatch", "revision_mismatch", "cutoff_disagreement", "schema_skew",
    "configuration_skew", "history_missing", "redis_not_empty",
    "redis_used_as_truth", "unresolved_submission", "duplicate_schedule",
    "duplicate_reservation", "wrong_tenant", "evidence_gap", "outbound_attempted",
    "production_write_attempted", "owner_material_present", "future_owner_missing",
    "normal_resume_prohibited", "read_only_ready", "invariant_failed",
]


class ProofClass(StrEnum):
    NATIVE_ISOLATED = "native_isolated"
    LOCAL_FIXTURE = "local_fixture"
    REPOSITORY = "repository"
    RECONSTRUCTED = "reconstructed"
    UNAVAILABLE = "unavailable"


class RecoveryState(StrEnum):
    PLANNED = "planned"
    EVIDENCE_CAPTURED = "evidence_captured"
    POINT_SET_FROZEN = "point_set_frozen"
    RESTORE_STARTED = "restore_started"
    RESTORE_VERIFIED = "restore_verified"
    RECONCILING = "reconciling"
    EVALUATED = "evaluated"
    READ_ONLY_READY = "read_only_ready"
    BLOCKED = "blocked"
    CLOSED = "closed"


class RecoveryModel(StrictModel):
    @model_validator(mode="before")
    @classmethod
    def no_floats(cls, value):
        def check(item):
            if isinstance(item, float):
                raise ValueError("Recovery contracts prohibit floating-point values")
            if isinstance(item, dict):
                for nested in item.values(): check(nested)
            elif isinstance(item, (list, tuple)):
                for nested in item: check(nested)
        check(value)
        return value

    @model_validator(mode="after")
    def utc_times(self):
        def check(value):
            if isinstance(value, datetime) and (value.tzinfo is None or value.utcoffset() is None
                    or value.utcoffset().total_seconds() != 0):
                raise ValueError("Recovery timestamps must be UTC")
            if isinstance(value, BaseModel):
                value = value.__dict__
            if isinstance(value, dict):
                for item in value.values(): check(item)
            elif isinstance(value, (list, tuple)):
                for item in value: check(item)
        check(self)
        return self


class RecoveryDomainPolicy(RecoveryModel):
    schema_version: Literal[1] = 1
    domain_id: DomainId
    owner: Literal["convex", "timescale", "temporal", "repository", "redis", "execution_reconciliation", "secret_custody"]
    criticality: Literal["critical", "required_read_only"]
    method: Literal["native_isolated_restore", "logical_isolated_restore", "restore_then_reconcile", "exact_manifest", "empty_rebuild", "authoritative_reconcile", "future_owner"]
    evidence_kinds: list[EvidenceKind] = Field(min_length=1, max_length=6)
    rpo_target_seconds: int | None = Field(default=None, ge=0, le=2_592_000)
    read_only_rto_target_seconds: int | None = Field(default=None, ge=0, le=2_592_000)
    independent_proof_required: bool
    omission_behavior: Literal["block", "unavailable"]
    policy_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")


class BackupEvidenceReceipt(RecoveryModel):
    schema_version: Literal[1] = 1
    receipt_id: str = Field(pattern=r"^ber_[a-f0-9]{48}$")
    run_id: str = Field(pattern=r"^recovery_[a-f0-9]{32}$")
    domain_id: DomainId
    tenant_key: str = Field(pattern=r"^tenant_[a-f0-9]{16}$")
    cutoff_at: datetime | None
    opaque_sequence_hash: Hash | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    repository_revision: Sha40
    schema_revision_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    configuration_revision_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    item_count: int = Field(ge=0, le=1_000_000_000)
    checksum: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    proof_class: ProofClass
    verified: bool
    reason_codes: list[ReasonCode] = Field(max_length=12)
    gaps: list[ReasonCode] = Field(max_length=12)
    captured_at: datetime
    canonical_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def valid_capture(self):
        if self.cutoff_at is not None and self.cutoff_at > self.captured_at:
            raise ValueError("Recovery evidence cutoff cannot follow capture")
        if len(set(self.reason_codes)) != len(self.reason_codes) or len(set(self.gaps)) != len(self.gaps):
            raise ValueError("Recovery evidence reasons and gaps must be unique")
        if self.verified and (self.proof_class == ProofClass.UNAVAILABLE
                or self.reason_codes != ["verified"] or self.gaps or self.cutoff_at is None):
            raise ValueError("Verified recovery evidence must be complete and explicit")
        if not self.verified and ("verified" in self.reason_codes or not self.gaps
                or set(self.reason_codes) != set(self.gaps)):
            raise ValueError("Unverified recovery evidence must declare matching gaps")
        return self


class RecoveryPointSet(RecoveryModel):
    schema_version: Literal[1] = 1
    point_set_id: str = Field(pattern=r"^rps_[a-f0-9]{48}$")
    run_id: str = Field(pattern=r"^recovery_[a-f0-9]{32}$")
    tenant_key: str = Field(pattern=r"^tenant_[a-f0-9]{16}$")
    registry_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    receipt_hashes: list[Hash] = Field(min_length=7, max_length=7)
    receipt_bindings: dict[DomainId, Hash]
    domain_cutoffs: dict[DomainId, datetime | None]
    cutoff_spread_seconds: int | None = Field(default=None, ge=0, le=2_592_000)
    coverage: Literal["complete", "blocked"]
    reason_codes: list[ReasonCode] = Field(max_length=16)
    frozen_at: datetime
    canonical_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def no_fabricated_global_time(self):
        if set(self.domain_cutoffs) != set(DomainId.__args__):
            raise ValueError("Recovery point set must retain every per-domain cutoff")
        if set(self.receipt_bindings) != set(DomainId.__args__) or len(set(self.receipt_bindings.values())) != 7:
            raise ValueError("Recovery point set must bind seven unique domain receipts")
        if set(self.receipt_hashes) != set(self.receipt_bindings.values()):
            raise ValueError("Recovery receipt bindings must match the frozen hash set")
        if self.receipt_hashes != sorted(self.receipt_hashes):
            raise ValueError("Recovery receipt hashes must be ordered")
        if (self.coverage == "complete") != (not self.reason_codes):
            raise ValueError("Recovery point-set coverage contradicts its reasons")
        return self


class CrossStateFinding(RecoveryModel):
    finding_id: str = Field(pattern=r"^csf_[a-f0-9]{48}$")
    comparison: Literal["jobs_credits", "proposals_approvals_fills", "workflows_schedules", "release_configuration", "executions_nonces_uncertainty", "redis_reconstruction"]
    status: Literal["match", "blocked"]
    reason_code: ReasonCode
    evidence_hashes: list[Hash] = Field(min_length=1, max_length=7)
    left_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    right_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    canonical_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def evidence_matches_status(self):
        if len(set(self.evidence_hashes)) != len(self.evidence_hashes):
            raise ValueError("Cross-state evidence bindings must be unique")
        if (self.status == "match") != (self.reason_code == "verified"
                and self.left_hash == self.right_hash):
            raise ValueError("Cross-state status contradicts bound evidence")
        return self


class CrossStateReconciliationDecision(RecoveryModel):
    decision_id: str = Field(pattern=r"^csr_[a-f0-9]{48}$")
    restore_receipt_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    finding_hashes: list[Hash] = Field(min_length=6, max_length=6)
    outcome: Literal["consistent", "blocked"]
    reason_codes: list[ReasonCode] = Field(max_length=16)
    evaluated_at: datetime
    canonical_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def unique_findings(self):
        if len(set(self.finding_hashes)) != 6:
            raise ValueError("Reconciliation must bind six unique findings")
        if (self.outcome == "consistent") != (not self.reason_codes):
            raise ValueError("Reconciliation outcome contradicts its reasons")
        return self


class RecoveryReadinessVerdict(RecoveryModel):
    verdict_id: str = Field(pattern=r"^rrv_[a-f0-9]{48}$")
    point_set_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    restore_receipt_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    reconciliation_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    read_only_outcome: Literal["ready", "blocked"]
    normal_resume_outcome: Literal["blocked"] = "blocked"
    reason_codes: list[ReasonCode] = Field(min_length=1, max_length=16)
    readiness_ttl_seconds: Literal[900] = READINESS_TTL_SECONDS
    evaluated_at: datetime
    expires_at: datetime
    canonical_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def valid_expiry(self):
        if self.expires_at <= self.evaluated_at:
            raise ValueError("Recovery readiness expiry must follow evaluation")
        if int((self.expires_at - self.evaluated_at).total_seconds()) != self.readiness_ttl_seconds:
            raise ValueError("Recovery readiness TTL must be registry-owned")
        ready = self.reason_codes == ["read_only_ready", "normal_resume_prohibited"]
        if (self.read_only_outcome == "ready") != ready:
            raise ValueError("Recovery readiness outcome contradicts its reasons")
        return self


class ReadOnlyResumeReceipt(RecoveryModel):
    receipt_id: str = Field(pattern=r"^ror_[a-f0-9]{48}$")
    readiness_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")
    allowed_operations: list[Literal["inspection", "render_previous_safe", "read_only_reconcile"]] = Field(min_length=3, max_length=3)
    prohibited_operations: list[Literal["provider_dispatch", "credit_reservation", "proposal", "approval", "execution", "signing", "broadcast", "external_mutation", "authority_relaxation"]] = Field(min_length=9, max_length=9)
    expires_at: datetime
    canonical_hash: Hash = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def fixed_capabilities(self):
        allowed = ["inspection", "render_previous_safe", "read_only_reconcile"]
        prohibited = ["provider_dispatch", "credit_reservation", "proposal", "approval",
            "execution", "signing", "broadcast", "external_mutation", "authority_relaxation"]
        if self.allowed_operations != allowed or self.prohibited_operations != prohibited:
            raise ValueError("Read-only recovery capabilities are fixed")
        return self
