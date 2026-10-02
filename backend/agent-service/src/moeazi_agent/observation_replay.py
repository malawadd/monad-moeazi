"""Order-independent admission of recorded market observations for research replay."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal
from fractions import Fraction
from typing import Iterable

from .observation_contracts import (
    EvidenceSnapshot, ExcludedObservation, InstrumentVersion, MarketObservation,
    canonical_hash, utc,
)


def _book_quality(row: MarketObservation, instrument: InstrumentVersion) -> str | None:
    bids = [Decimal(level.price_quote_per_base) for level in row.bids]
    asks = [Decimal(level.price_quote_per_base) for level in row.asks]
    if any(left <= right for left, right in zip(bids, bids[1:])) \
            or any(left >= right for left, right in zip(asks, asks[1:])) \
            or bids[0] >= asks[0]:
        return "invalid_book_order"
    step = Fraction(instrument.lot_step)
    for level in (*row.bids, *row.asks):
        size = Fraction(level.size_base)
        if size % step != 0:
            return "invalid_native_size_step"
    return None


def replay_observations(
    instruments: Iterable[InstrumentVersion], observations: Iterable[MarketObservation],
    cutoff_at: datetime, max_age_ms: int,
) -> EvidenceSnapshot:
    cutoff = utc(cutoff_at)
    if max_age_ms < 0:
        raise ValueError("max_age_ms cannot be negative")
    instrument_rows = tuple(instruments)
    registry = {row.instrument_version_id: row for row in instrument_rows}
    if len(registry) != len(instrument_rows):
        raise ValueError("Duplicate instrument version IDs")
    grouped: dict[tuple[str, str, str], list[MarketObservation]] = defaultdict(list)
    for observation in observations:
        grouped[(observation.source_id, observation.instrument_version_id,
                 observation.source_event_id)].append(observation)

    candidates: list[MarketObservation] = []
    excluded: list[ExcludedObservation] = []
    def reject(observation: MarketObservation, reason: str) -> None:
        excluded.append(ExcludedObservation(source_id=observation.source_id,
            source_event_id=observation.source_event_id, reason=reason,
            raw_payload_hash=observation.raw_payload_hash))

    for key in sorted(grouped):
        rows = grouped[key]
        if len({canonical_hash(row.model_dump(mode="json")) for row in rows}) != 1:
            for row in rows:
                reject(row, "source_event_conflict")
            continue
        row = min(rows, key=lambda item: (item.received_at, item.available_at,
            canonical_hash(item.model_dump(mode="json"))))
        instrument = registry.get(row.instrument_version_id)
        if not instrument:
            reject(row, "unknown_instrument_version")
        elif instrument.venue_id != row.source_id:
            reject(row, "source_instrument_mismatch")
        elif instrument.effective_at > row.event_at:
            reject(row, "instrument_not_effective")
        elif row.event_at > cutoff:
            reject(row, "event_after_cutoff")
        elif row.event_at > row.available_at:
            reject(row, "event_after_availability")
        elif row.event_at > row.received_at:
            reject(row, "future_event")
        elif row.available_at > row.received_at:
            reject(row, "future_availability")
        elif row.available_at > cutoff:
            reject(row, "unavailable_at_cutoff")
        elif cutoff - row.event_at > timedelta(milliseconds=max_age_ms):
            reject(row, "stale_at_cutoff")
        elif row.finality in {"unknown", "pending", "reorged"}:
            reject(row, f"finality_{row.finality}")
        elif row.continuity == "snapshot_only" and row.finality != "not_applicable":
            reject(row, "snapshot_only_finality_claim")
        elif row.continuity == "sequenced" and row.finality != "confirmed":
            reject(row, "sequenced_finality_unconfirmed")
        elif row.source_kind == "recorded_native" and row.source_rights_ref != "internal_qualification_only":
            reject(row, "source_rights_unapproved")
        elif row.source_kind == "documented_example" and row.source_rights_ref != "documentation_example_only":
            reject(row, "source_rights_unapproved")
        elif row.source_kind == "recorded_native" and (row.source_id != "hyperliquid"
                or instrument.price_rule != ("hyperliquid_spot_significant_figures_v1"
                    if instrument.product_kind == "spot" else "hyperliquid_perp_significant_figures_v1")):
            reject(row, "unapproved_price_rule")
        elif quality := _book_quality(row, instrument):
            reject(row, quality)
        else:
            candidates.append(row)

    sequenced: dict[tuple[str, str, str], list[MarketObservation]] = defaultdict(list)
    for row in candidates:
        if row.continuity == "sequenced":
            sequenced[(row.source_id, row.instrument_version_id,
                       row.observation_kind)].append(row)
    gaps: set[tuple[str, str, str]] = set()
    collisions: set[tuple[str, str, str]] = set()
    for key, rows in sequenced.items():
        positions = sorted({row.sequence for row in rows if row.sequence is not None})
        if any(right != left + 1 for left, right in zip(positions, positions[1:])):
            gaps.add(key)
        if len(positions) != len(rows):
            collisions.add(key)
    accepted = []
    for row in candidates:
        key = (row.source_id, row.instrument_version_id, row.observation_kind)
        if key in collisions:
            reject(row, "sequence_collision")
        elif key in gaps:
            reject(row, "sequence_gap")
        else:
            accepted.append(row)

    accepted_hashes = tuple(sorted(canonical_hash(row.model_dump(mode="json")) for row in accepted))
    excluded_sorted = tuple(sorted(excluded, key=lambda row: (
        row.source_id, row.source_event_id, row.raw_payload_hash, row.reason)))
    rights = tuple(sorted({row.source_rights_ref for row in accepted}))
    instrument_ids = tuple(sorted({row.instrument_version_id for row in accepted}))
    body = {
        "schema_version": 1, "cutoff_at": cutoff.isoformat().replace("+00:00", "Z"),
        "instrument_version_ids": instrument_ids,
        "accepted_observation_hashes": accepted_hashes,
        "excluded": [row.model_dump(mode="json") for row in excluded_sorted],
        "source_rights_refs": rights, "has_gap": bool(gaps or collisions),
    }
    return EvidenceSnapshot(**body, snapshot_hash=canonical_hash(body))
