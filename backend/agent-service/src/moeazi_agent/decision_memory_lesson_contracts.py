"""Evaluation-only lesson lifecycle records; never prompts or authority."""
from __future__ import annotations

from typing import Literal
from pydantic import Field, model_validator
from .decision_memory_canonical import digest, require_hash, require_id, utc
from .decision_memory_scope_contracts import Frozen


class LessonCandidate(Frozen):
    candidate_id: str
    scope_hash: str
    supporting_episode_ids: tuple[str, ...]
    counterexample_episode_ids: tuple[str, ...]
    applicability: tuple[str, ...]
    lesson: str = Field(min_length=3, max_length=280)
    falsifier: str = Field(min_length=3, max_length=280)
    confidence_bps: int = Field(ge=0, le=10000)
    expires_at: str
    state: Literal["draft", "rejected", "evaluation_only", "frozen", "expired", "rolled_back"]
    candidate_hash: str

    @model_validator(mode="after")
    def closed(self):
        require_id(self.candidate_id); require_hash(self.scope_hash); utc(self.expires_at)
        if not self.supporting_episode_ids or not self.counterexample_episode_ids:
            raise ValueError("decision_memory_lesson_support")
        if tuple(sorted(set(self.supporting_episode_ids))) != self.supporting_episode_ids or tuple(sorted(set(self.counterexample_episode_ids))) != self.counterexample_episode_ids:
            raise ValueError("decision_memory_lesson_order")
        if self.candidate_hash != digest(self.model_dump(exclude={"candidate_hash"}, mode="json")):
            raise ValueError("decision_memory_candidate_hash")
        return self


class LessonTransition(Frozen):
    candidate_hash: str
    from_state: str
    to_state: str
    at: str
    transition_hash: str

    @model_validator(mode="after")
    def legal(self):
        require_hash(self.candidate_hash); utc(self.at)
        legal = {("draft", "evaluation_only"), ("evaluation_only", "frozen"),
                 ("draft", "rejected"), ("frozen", "expired"), ("frozen", "rolled_back")}
        if (self.from_state, self.to_state) not in legal: raise ValueError("decision_memory_lesson_transition")
        if self.transition_hash != digest(self.model_dump(exclude={"transition_hash"}, mode="json")):
            raise ValueError("decision_memory_transition_hash")
        return self
