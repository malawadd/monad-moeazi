"""Pure maturity stage.  It deliberately treats uncertainty as non-retrievable."""
from __future__ import annotations
from .decision_memory_canonical import digest
from .decision_memory_episode_contracts import DecisionEpisode
from .decision_memory_outcome_contracts import OutcomeMaturityReceipt, OutcomeObservationRevision


def latest_as_of(revisions: tuple[OutcomeObservationRevision, ...], as_of: str) -> OutcomeObservationRevision | None:
    eligible = [item for item in revisions if max(item.source_time, item.evaluated_at, item.created_at) <= as_of]
    return max(eligible, key=lambda item: item.revision, default=None)


def evaluate(episode: DecisionEpisode, revisions: tuple[OutcomeObservationRevision, ...], as_of: str) -> OutcomeMaturityReceipt:
    head = latest_as_of(revisions, as_of); reasons: tuple[str, ...]; status: str
    if head is None: status, reasons = "pending", ("missing_outcome",)
    elif head.disputed or not head.reconciled: status, reasons = "disputed", ("unresolved_reconciliation",)
    elif head.corrected: status, reasons = "disputed", ("correction_requires_recompute",)
    elif as_of < episode.declared_horizon_end: status, reasons = "pending", ("horizon_not_elapsed",)
    elif head.quality != "passing": status, reasons = "pending", ("quality_not_proven",)
    else: status, reasons = "mature", ("complete_reproducible_fixture",)
    value = {"episode_id": episode.episode_id, "revision_hash": head.revision_hash if head else None,
        "status": status, "reasons": reasons, "evaluated_at": as_of}
    return OutcomeMaturityReceipt(**value, receipt_hash=digest(value))
