"""Strict identity and policy contracts; acknowledgement is not incident state."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from pydantic import ConfigDict, Field, model_validator
from .contracts import StrictModel
from .incident_communication_canonical import HASH, ID, digest, normal


class Model(StrictModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    @model_validator(mode="before")
    @classmethod
    def canonical(cls, value: Any): normal(value); return value


class SafetyIncidentRevisionRef(Model):
    operator_test_id: str = Field(pattern=ID); tenant_fingerprint: str = Field(pattern=ID)
    account_fingerprint: str = Field(pattern=ID); incident_id: str = Field(pattern=ID)
    revision: int = Field(ge=1, le=1_000_000); predecessor_revision_hash: str | None = None
    authoritative_owner: Literal["dependency_safety_fixture"]
    owner_contract_hash: str; owner_release_hash: str = Field(pattern=r"^[a-f0-9]{40}$")
    severity: Literal["critical", "high", "medium"]; state: Literal["open", "resolved"]
    materiality: Literal["material"]; reason_code: Literal["dependency_outage", "uncertain_submission", "reconciliation_mismatch", "clock_fault", "instrument_delisting", "evidence_correction", "emergency_stop"]
    event_at: datetime; source_receipt_hashes: list[str] = Field(min_length=1, max_length=8); revision_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.source_receipt_hashes != sorted(set(self.source_receipt_hashes)) or not all(HASH.fullmatch(x) for x in self.source_receipt_hashes): raise ValueError("source receipt closure invalid")
        values = [self.owner_contract_hash, self.revision_hash] + ([self.predecessor_revision_hash] if self.predecessor_revision_hash else [])
        if not all(HASH.fullmatch(x) for x in values) or self.revision_hash != digest(self.model_dump(exclude={"revision_hash"})): raise ValueError("incident revision hash invalid")
        return self


class IncidentCommunicationPolicy(Model):
    policy_id: Literal["customer_safe_in_app"]; version: Literal["v1"]; classification: Literal["customer_safe"]
    channel: Literal["in_app"]; audience_roles: list[Literal["owner", "safety_delegate"]]
    template_version: Literal["v1"]; safe_fields: list[Literal["severity", "state", "reason_code", "revision"]]
    acknowledgement_deadline_seconds: int = Field(ge=1, le=3600); retry_schedule_seconds: list[int]
    max_attempts: int = Field(ge=1, le=5); escalation_role: Literal["safety_delegate"]
    prohibited_data_classes: list[Literal["credential", "secret", "diagnostic", "address", "url", "command", "signature"]]; policy_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.audience_roles != sorted(set(self.audience_roles)) or self.safe_fields != sorted(set(self.safe_fields)) or self.retry_schedule_seconds != sorted(set(self.retry_schedule_seconds)) or self.prohibited_data_classes != sorted(set(self.prohibited_data_classes)): raise ValueError("policy sets must be sorted")
        if len(self.retry_schedule_seconds) != self.max_attempts - 1 or not HASH.fullmatch(self.policy_hash) or self.policy_hash != digest(self.model_dump(exclude={"policy_hash"})): raise ValueError("policy hash invalid")
        return self


class IncidentAudienceResolution(Model):
    revision_hash: str; policy_hash: str; tenant_fingerprint: str = Field(pattern=ID); membership_revision: int = Field(ge=1)
    audience_id: str = Field(pattern=ID); recipient_fingerprint: str = Field(pattern=ID); role: Literal["owner", "safety_delegate"]
    eligible: bool; reason: Literal["eligible", "cross_tenant", "stale_membership"]; resolved_at: datetime; resolution_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.revision_hash, self.policy_hash, self.resolution_hash)) or self.eligible != (self.reason == "eligible") or self.resolution_hash != digest(self.model_dump(exclude={"resolution_hash"})): raise ValueError("audience resolution invalid")
        return self
