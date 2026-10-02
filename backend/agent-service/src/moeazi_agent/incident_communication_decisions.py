"""Forward-only outcomes; none can alter incident or execution authority."""
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import Field, model_validator
from .incident_communication_contracts import Model
from .incident_communication_canonical import HASH, digest

class IncidentEscalationDecision(Model):
    row_hash: str; acknowledgement_closed: bool; deadline: datetime; evaluated_at: datetime
    outcome: Literal["none","in_app_escalation","dead_letter","superseded"]; new_audience_id: str | None = None
    reason_codes: list[str]; incident_authority_effect: Literal["none"] = "none"; decision_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.reason_codes != sorted(set(self.reason_codes)) or not HASH.fullmatch(self.row_hash) or not HASH.fullmatch(self.decision_hash) or self.decision_hash != digest(self.model_dump(exclude={"decision_hash"})): raise ValueError("escalation invalid")
        return self

class IncidentCommunicationTransition(Model):
    row_hash: str; predecessor_hash: str | None = None; state: Literal["intent_created","displayed","acknowledged","superseded","dead_letter"]
    observed_at: datetime; transition_hash: str
    @model_validator(mode="after")
    def valid(self):
        values=[self.row_hash,self.transition_hash]+([self.predecessor_hash] if self.predecessor_hash else [])
        if not all(HASH.fullmatch(x) for x in values) or self.transition_hash != digest(self.model_dump(exclude={"transition_hash"})): raise ValueError("transition invalid")
        return self

class IncidentCommunicationConflict(Model):
    scope_hash: str; reason: str = Field(pattern=r"^[a-z_]{3,80}$"); conflict_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.scope_hash) or not HASH.fullmatch(self.conflict_hash) or self.conflict_hash != digest(self.model_dump(exclude={"conflict_hash"})): raise ValueError("conflict invalid")
        return self

class IncidentCommunicationBundleDecision(Model):
    revision_hash: str; outbox_count: int = Field(ge=0); displayed_count: int = Field(ge=0); acknowledgement_count: int = Field(ge=0)
    superseded_count: int = Field(ge=0); dead_letter_count: int = Field(ge=0); external_attempts: Literal[0] = 0; provider_cost: Literal[0] = 0
    incident_authority_effect: Literal["none"] = "none"; outcome: Literal["would_send","blocked","dead_letter"]; decision_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.revision_hash,self.decision_hash)) or self.decision_hash != digest(self.model_dump(exclude={"decision_hash"})): raise ValueError("bundle decision invalid")
        return self
