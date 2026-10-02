"""Immutable lifecycle fold rules for frozen fixture events."""
from __future__ import annotations

from .instrument_lifecycle_contracts import InstrumentLifecycleEvent


def fold(events: list[InstrumentLifecycleEvent]) -> tuple[list[InstrumentLifecycleEvent], list[str], int]:
    """Fold native order, retaining late events and treating any inconsistency as disputed."""
    reasons: set[str] = set(); by_id: dict[str, InstrumentLifecycleEvent] = {}
    ordered: list[InstrumentLifecycleEvent] = []
    expected: int | None = None; by_sequence: dict[int, InstrumentLifecycleEvent] = {}
    for event in sorted(events, key=lambda item: (item.native_sequence, item.event_hash)):
        previous = by_id.get(event.event_id)
        if previous and previous.event_hash != event.event_hash: reasons.add("event_id_conflict"); continue
        if previous: continue
        native_peer = by_sequence.get(event.native_sequence)
        if native_peer and native_peer.event_hash != event.event_hash:
            reasons.add("native_sequence_conflict"); continue
        by_id[event.event_id] = event
        by_sequence[event.native_sequence] = event
        if expected is None and event.native_sequence > 0: reasons.add("event_gap")
        if expected is not None and event.native_sequence > expected + 1: reasons.add("event_gap")
        if expected is not None and event.native_sequence < expected and event.event_type != "correction": reasons.add("event_rollback")
        expected = max(expected or event.native_sequence, event.native_sequence)
        ordered.append(event)
    known_hashes = {item.event_hash for item in ordered}
    replacements: set[str] = set()
    for event in ordered:
        if event.event_type in {"correction", "supersession"}:
            if event.supersedes_event_hash not in known_hashes:
                reasons.add("event_replacement_target_unknown")
            elif event.supersedes_event_hash in replacements:
                reasons.add("event_replacement_fork")
            else:
                replacements.add(event.supersedes_event_hash)
    watermark = max((item.native_sequence for item in ordered), default=0)
    return ordered, sorted(reasons), watermark
