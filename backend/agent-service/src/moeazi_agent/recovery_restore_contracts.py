from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from .recovery_contracts import DomainId, Hash, ReasonCode, RecoveryModel, Sha40


class IsolatedRestorePlan(RecoveryModel):
    schema_version: Literal[1] = 1
    plan_id: str = Field(pattern=r"^irp_[a-f0-9]{48}$")
    point_set_hash: Hash
    repository_revision: Sha40
    migration_set_hash: Hash
    target: Literal["isolated_fixture"] = "isolated_fixture"
    network_policy: Literal["deny_all"] = "deny_all"
    production_writes_allowed: Literal[False] = False
    steps: list[Literal["verify_inputs", "restore_durable_owners", "start_redis_empty",
        "rebuild_redis", "reconcile", "evaluate"]] = Field(min_length=6, max_length=6)
    idempotency_key: str = Field(pattern=r"^recovery:[a-f0-9]{32}$")
    canonical_hash: Hash

    @model_validator(mode="after")
    def exact_steps(self):
        expected = ["verify_inputs", "restore_durable_owners", "start_redis_empty",
            "rebuild_redis", "reconcile", "evaluate"]
        if self.steps != expected:
            raise ValueError("Isolated restore steps must use the exact safe sequence")
        return self


class DomainRestoreResult(RecoveryModel):
    domain_id: DomainId
    evidence_receipt_hash: Hash
    status: Literal["verified", "blocked", "unavailable"]
    item_count: int = Field(ge=0, le=1_000_000_000)
    checksum: Hash
    reason_codes: list[ReasonCode] = Field(max_length=12)
    duration_ms: int = Field(ge=0, le=86_400_000)

    @model_validator(mode="after")
    def coherent_status(self):
        if (self.status == "verified") != (self.reason_codes == ["verified"]):
            raise ValueError("Restore status contradicts its reason codes")
        return self


class RestoreAttemptReceipt(RecoveryModel):
    schema_version: Literal[1] = 1
    attempt_id: str = Field(pattern=r"^rar_[a-f0-9]{48}$")
    plan_hash: Hash
    idempotency_key: str = Field(pattern=r"^recovery:[a-f0-9]{32}$")
    domain_results: list[DomainRestoreResult] = Field(min_length=7, max_length=7)
    outbound_attempt_count: int = Field(ge=0, le=100)
    production_write_count: int = Field(ge=0, le=100)
    terminal_result: Literal["verified", "blocked"]
    started_at: datetime
    finished_at: datetime
    canonical_hash: Hash

    @model_validator(mode="after")
    def complete_attempt(self):
        if self.finished_at < self.started_at:
            raise ValueError("Recovery attempt finish cannot precede start")
        if {item.domain_id for item in self.domain_results} != set(DomainId.__args__):
            raise ValueError("Recovery attempt must contain every domain exactly once")
        verified = all(item.status == "verified" for item in self.domain_results) \
            and self.outbound_attempt_count == 0 and self.production_write_count == 0
        if (self.terminal_result == "verified") != verified:
            raise ValueError("Recovery terminal result contradicts domain or side-effect evidence")
        return self
