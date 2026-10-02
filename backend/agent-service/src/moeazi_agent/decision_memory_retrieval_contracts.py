"""Permission-first bounded retrieval contracts."""
from __future__ import annotations

from typing import Literal
from pydantic import Field, model_validator
from .decision_memory_canonical import digest, require_hash, require_id, utc
from .decision_memory_scope_contracts import Frozen


class RetrievalQuery(Frozen):
    query_id: str
    scope_hash: str
    decision_time: str
    as_of: str
    top_k: int = Field(ge=1, le=5)
    token_ceiling: int = Field(ge=1, le=2048)
    algorithm_version: Literal["decision-memory-local-v1"] = "decision-memory-local-v1"
    query_hash: str

    @model_validator(mode="after")
    def closed(self):
        require_id(self.query_id); require_hash(self.scope_hash); utc(self.decision_time); utc(self.as_of)
        if self.query_hash != digest(self.model_dump(exclude={"query_hash"}, mode="json")):
            raise ValueError("decision_memory_query_hash")
        return self


class RetrievalCandidateScore(Frozen):
    episode_id: str
    episode_hash: str
    category: Literal["positive", "negative", "abstention", "counterexample"]
    total_score: int = Field(ge=0, le=1000000)
    tokens: int = Field(ge=1, le=2048)
    candidate_hash: str

    @model_validator(mode="after")
    def closed(self):
        require_id(self.episode_id); require_hash(self.episode_hash)
        if self.candidate_hash != digest(self.model_dump(exclude={"candidate_hash"}, mode="json")):
            raise ValueError("decision_memory_retrieval_candidate_hash")
        return self


class MemoryBundle(Frozen):
    query_hash: str
    status: Literal["bundle", "empty", "blocked"]
    members: tuple[RetrievalCandidateScore, ...]
    token_count: int = Field(ge=0, le=2048)
    reasons: tuple[str, ...]
    bundle_hash: str

    @model_validator(mode="after")
    def closed(self):
        require_hash(self.query_hash)
        if len(self.members) > 5 or sum(member.tokens for member in self.members) != self.token_count:
            raise ValueError("decision_memory_bundle_tokens")
        if self.status == "bundle" and not self.members: raise ValueError("decision_memory_bundle_empty")
        if self.status != "bundle" and self.members: raise ValueError("decision_memory_bundle_members")
        if self.bundle_hash != digest(self.model_dump(exclude={"bundle_hash"}, mode="json")):
            raise ValueError("decision_memory_bundle_hash")
        return self
