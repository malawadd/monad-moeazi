"""Immutable message, delivery and acknowledgement contracts for local replay."""
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import Field, model_validator
from .incident_communication_contracts import Model
from .incident_communication_canonical import HASH, digest


class IncidentMessage(Model):
    revision_hash: str; audience_resolution_hash: str; policy_hash: str; template_version: Literal["v1"]
    kind: Literal["opened", "updated", "corrected", "resolved"]; fact_codes: list[str]; rendered_copy: str = Field(min_length=1, max_length=240)
    redaction_decision: Literal["allowlisted"]; template_hash: str; content_hash: str; message_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.fact_codes != sorted(set(self.fact_codes)) or not all(HASH.fullmatch(x) for x in (self.revision_hash,self.audience_resolution_hash,self.policy_hash,self.template_hash,self.content_hash,self.message_hash)) or self.message_hash != digest(self.model_dump(exclude={"message_hash"})): raise ValueError("message invalid")
        return self


class IncidentDispatchOutboxRow(Model):
    incident_id: str; revision: int = Field(ge=1); audience_id: str; template_version: Literal["v1"]; channel: Literal["in_app"]
    dispatch_id: str; message_hash: str; pending_at: datetime; acknowledgement_deadline: datetime; attempt_ceiling: int = Field(ge=1, le=5); row_hash: str
    @model_validator(mode="after")
    def valid(self):
        expected=digest({"incident_id":self.incident_id,"revision":self.revision,"audience_id":self.audience_id,"template_version":self.template_version,"channel":self.channel})
        if self.dispatch_id != expected or not all(HASH.fullmatch(x) for x in (self.message_hash,self.row_hash)) or self.row_hash != digest(self.model_dump(exclude={"row_hash"})): raise ValueError("outbox row invalid")
        return self


class IncidentDeliveryReceipt(Model):
    row_hash: str; message_hash: str; attempt: int = Field(ge=1, le=5); predecessor_receipt_hash: str | None = None
    display_idempotency_key: str; transport_acceptance: Literal["not_applicable"]; outcome: Literal["displayed","failed","duplicate_suppressed","superseded"]
    failure_reason: Literal["none","in_app_unavailable","retry_exhausted"] = "none"; observed_at: datetime; terminal: bool; receipt_hash: str
    @model_validator(mode="after")
    def valid(self):
        values=[self.row_hash,self.message_hash,self.receipt_hash]+([self.predecessor_receipt_hash] if self.predecessor_receipt_hash else [])
        if not all(HASH.fullmatch(x) for x in values) or self.receipt_hash != digest(self.model_dump(exclude={"receipt_hash"})): raise ValueError("delivery receipt invalid")
        return self


class IncidentAcknowledgementReceipt(Model):
    row_hash: str; displayed_receipt_hash: str; audience_id: str; membership_revision: int = Field(ge=1); session_revision: int = Field(ge=1)
    acknowledgement_key: str; outcome: Literal["accepted","stale_rejected","duplicate_suppressed","superseded"]; acknowledged_at: datetime
    incident_authority_effect: Literal["none"] = "none"; receipt_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.row_hash,self.displayed_receipt_hash,self.receipt_hash)) or self.receipt_hash != digest(self.model_dump(exclude={"receipt_hash"})): raise ValueError("acknowledgement invalid")
        return self
