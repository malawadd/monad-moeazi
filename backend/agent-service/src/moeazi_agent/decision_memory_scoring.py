"""Fixed-point score stage; no profit-based quality judgement and no floats."""
from __future__ import annotations
from .decision_memory_canonical import digest
from .decision_memory_episode_contracts import DecisionEpisode
from .decision_memory_outcome_contracts import EpisodeScore, OutcomeMaturityReceipt, OutcomeObservationRevision


def score(episode: DecisionEpisode, outcome: OutcomeObservationRevision, receipt: OutcomeMaturityReceipt) -> EpisodeScore | None:
    if receipt.status != "mature": return None
    actual = {"up": 0, "flat": 1, "down": 2}[outcome.realized_direction]
    chosen = max(range(3), key=lambda index: episode.forecast_bps[index])
    brier = sum((probability - (10000 if index == actual else 0)) ** 2 for index, probability in enumerate(episode.forecast_bps))
    label = "correct" if chosen == actual else ("abstention" if episode.abstained else "wrong_direction")
    value = {"episode_id": episode.episode_id, "receipt_hash": receipt.receipt_hash, "brier_bps": brier,
        "log_loss_milli": 10000 - episode.forecast_bps[actual], "error_label": label,
        "scorer_version": "decision-memory-local-v1"}
    return EpisodeScore(**value, score_hash=digest(value))
