"""Immutable synthetic episode records."""
from __future__ import annotations

from typing import Literal
from pydantic import Field, model_validator
from .decision_memory_canonical import digest, require_hash, require_id, utc
from .decision_memory_scope_contracts import Frozen, DecisionMemoryScope


class EpisodeVersionRefs(Frozen):
    evidence_root_hash: str
    evidence_as_of: str
    prompt_bundle_hash: str
    policy_hash: str
    scorer_version: str = Field(pattern=r"^[a-z0-9-]{3,79}$")

    @model_validator(mode="after")
    def closed(self):
        for value in (self.evidence_root_hash, self.prompt_bundle_hash, self.policy_hash): require_hash(value)
        utc(self.evidence_as_of); return self


class DecisionEpisode(Frozen):
    episode_id: str
    analysis_id: str
    scope: DecisionMemoryScope
    refs: EpisodeVersionRefs
    forecast_bps: tuple[int, int, int]
    abstained: bool
    declared_horizon_end: str
    decision_time: str
    created_at: str
    episode_hash: str

    @model_validator(mode="after")
    def closed(self):
        require_id(self.episode_id); require_id(self.analysis_id)
        if any(type(value) is not int or value < 0 or value > 10000 for value in self.forecast_bps) or sum(self.forecast_bps) != 10000:
            raise ValueError("decision_memory_forecast")
        if self.refs.evidence_as_of > self.decision_time or self.declared_horizon_end <= self.decision_time:
            raise ValueError("decision_memory_episode_time")
        for value in (self.declared_horizon_end, self.decision_time, self.created_at): utc(value)
        if self.episode_hash != digest(self.model_dump(exclude={"episode_hash"}, mode="json")):
            raise ValueError("decision_memory_episode_hash")
        return self
