"""Pure, exact-filter memory retrieval.  Any uncertainty returns an empty bundle."""
from __future__ import annotations
from .decision_memory_canonical import digest
from .decision_memory_episode_contracts import DecisionEpisode
from .decision_memory_outcome_contracts import EpisodeScore, OutcomeMaturityReceipt
from .decision_memory_retrieval_contracts import MemoryBundle, RetrievalCandidateScore, RetrievalQuery


def retrieve(query: RetrievalQuery, rows: tuple[tuple[DecisionEpisode, OutcomeMaturityReceipt, EpisodeScore | None], ...]) -> MemoryBundle:
    candidates: list[RetrievalCandidateScore] = []
    for episode, receipt, score in rows:
        if (episode.scope.scope_hash != query.scope_hash or episode.decision_time >= query.decision_time
                or receipt.status != "mature" or score is None):
            continue
        category = "positive" if score.error_label == "correct" else "abstention" if score.error_label == "abstention" else "negative"
        raw = {"episode_id": episode.episode_id, "episode_hash": episode.episode_hash, "category": category,
               "total_score": max(0, 100000 - score.brier_bps), "tokens": 128}
        candidates.append(RetrievalCandidateScore(**raw, candidate_hash=digest(raw)))
    ordered = tuple(sorted(candidates, key=lambda item: (-item.total_score, item.episode_hash)))
    selected = tuple(item for item in ordered[:query.top_k] if (len([x for x in ordered[:query.top_k] if x.tokens <= query.token_ceiling]) > 0))
    token_count = sum(item.tokens for item in selected)
    status = "bundle" if selected and token_count <= query.token_ceiling else "empty"
    if status == "empty": selected, token_count = (), 0
    value = {"query_hash": query.query_hash, "status": status, "members": selected, "token_count": token_count,
             "reasons": ("bounded_fixture_retrieval",) if status == "bundle" else ("no_provable_eligible_memory",)}
    hashed = {**value, "members": tuple(item.model_dump(mode="json") for item in selected)}
    return MemoryBundle(**value, bundle_hash=digest(hashed))
