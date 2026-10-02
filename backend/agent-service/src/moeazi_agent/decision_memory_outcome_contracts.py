"""Append-only outcome, maturity and fixed-point score contracts."""
from __future__ import annotations

from typing import Literal
from pydantic import Field, model_validator
from .decision_memory_canonical import digest, require_hash, require_id, utc
from .decision_memory_scope_contracts import Frozen


class OutcomeObservationRevision(Frozen):
    episode_id: str
    horizon: str
    revision: int = Field(ge=1, le=1000000)
    predecessor_hash: str | None = None
    source_time: str
    evaluated_at: str
    as_of: str
    created_at: str
    realized_direction: Literal["up", "flat", "down"]
    return_bps: int = Field(ge=-1000000, le=1000000)
    quality: Literal["passing", "low", "missing"]
    disputed: bool = False
    corrected: bool = False
    reconciled: bool = True
    certified_actual: Literal[False] = False
    revision_hash: str

    @model_validator(mode="after")
    def closed(self):
        require_id(self.episode_id)
        if self.revision == 1 and self.predecessor_hash is not None: raise ValueError("decision_memory_predecessor")
        if self.revision > 1: require_hash(self.predecessor_hash or "")
        for value in (self.source_time, self.evaluated_at, self.as_of, self.created_at): utc(value)
        if not self.source_time <= self.evaluated_at <= self.created_at: raise ValueError("decision_memory_revision_time")
        if self.revision_hash != digest(self.model_dump(exclude={"revision_hash"}, mode="json")):
            raise ValueError("decision_memory_revision_hash")
        return self


class OutcomeMaturityReceipt(Frozen):
    episode_id: str
    revision_hash: str | None
    status: Literal["pending", "mature", "disputed", "invalidated"]
    reasons: tuple[str, ...]
    evaluated_at: str
    receipt_hash: str

    @model_validator(mode="after")
    def closed(self):
        require_id(self.episode_id); utc(self.evaluated_at)
        if not self.reasons: raise ValueError("decision_memory_maturity_reasons")
        if self.revision_hash is not None: require_hash(self.revision_hash)
        if self.receipt_hash != digest(self.model_dump(exclude={"receipt_hash"}, mode="json")):
            raise ValueError("decision_memory_maturity_hash")
        return self


class EpisodeScore(Frozen):
    episode_id: str
    receipt_hash: str
    brier_bps: int = Field(ge=0, le=100000000)
    log_loss_milli: int = Field(ge=0, le=100000000)
    error_label: Literal["correct", "wrong_direction", "abstention", "calibration_error"]
    scorer_version: str
    score_hash: str

    @model_validator(mode="after")
    def closed(self):
        require_id(self.episode_id); require_hash(self.receipt_hash)
        if self.score_hash != digest(self.model_dump(exclude={"score_hash"}, mode="json")):
            raise ValueError("decision_memory_score_hash")
        return self
