"""Independent Q2 replay oracles over synthetic fault observations."""
from datetime import datetime, timedelta, timezone

import pytest

from moeazi_agent.observation_contracts import BookLevel, InstrumentVersion, MarketObservation
from moeazi_agent.observation_replay import replay_observations


NOW = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
HASH = "a" * 64


def instrument(venue="venue-a", **changes):
    fields = dict(instrument_version_id=f"{venue}:BTC-USD:v1", venue_id=venue,
        native_instrument_id="BTC-USD", product_kind="spot",
        base_asset_unit_id=f"{venue}:BTC:8", quote_asset_unit_id=f"{venue}:USDC:6",
        settlement_asset_unit_id=f"{venue}:USDC:6", base_decimals=8,
        quote_decimals=6, settlement_decimals=6, size_decimals=8,
        contract_multiplier="1", price_rule="quote_per_base", lot_step="0.00000001",
        min_size="0.00001", margin_model="none", funding_model="none",
        effective_at=NOW - timedelta(days=1), registry_hash=HASH)
    return InstrumentVersion(**(fields | changes))


def book(venue="venue-a", event_id="book-1", **changes):
    fields = dict(instrument_version_id=f"{venue}:BTC-USD:v1", source_id=venue,
        source_event_id=event_id, source_kind="synthetic_fault",
        source_rights_ref=f"{venue}:fixture-rights", raw_payload_hash=HASH,
        observation_kind="book_snapshot", event_at=NOW - timedelta(seconds=2),
        received_at=NOW, available_at=NOW, sequence=None,
        continuity="snapshot_only", finality="not_applicable",
        bids=(BookLevel(price_quote_per_base="25000", size_base="0.01"),),
        asks=(BookLevel(price_quote_per_base="25001", size_base="0.02"),))
    return MarketObservation(**(fields | changes))


def replay(rows, instruments=None, cutoff=NOW, max_age_ms=5000):
    return replay_observations(instruments or [instrument()], rows, cutoff, max_age_ms)


def test_replay_keeps_same_symbol_venues_separate_and_is_order_independent():
    a = book(event_id="a", raw_payload_hash="a" * 64)
    b = book("venue-b", "b", raw_payload_hash="b" * 64)
    first = replay([a, b], [instrument("venue-a"), instrument("venue-b")])
    second = replay([b, a, a], [instrument("venue-b"), instrument("venue-a")])
    assert first.snapshot_hash == second.snapshot_hash
    assert len(first.accepted_observation_hashes) == 2
    assert first.instrument_version_ids == ("venue-a:BTC-USD:v1", "venue-b:BTC-USD:v1")
    assert first.source_rights_refs == ("venue-a:fixture-rights", "venue-b:fixture-rights")


def test_same_source_event_with_changed_raw_payload_is_quarantined():
    first = book(raw_payload_hash="a" * 64)
    changed = book(raw_payload_hash="b" * 64)
    result = replay([first, changed])
    assert result.accepted_observation_hashes == ()
    assert {row.reason for row in result.excluded} == {"source_event_conflict"}


def test_same_source_event_and_raw_payload_cannot_change_rights_or_times():
    first = book()
    changed = book(source_rights_ref="elevated-rights",
        received_at=NOW - timedelta(seconds=1), available_at=NOW - timedelta(seconds=1))
    result = replay([first, changed])
    assert result.accepted_observation_hashes == ()
    assert {row.reason for row in result.excluded} == {"source_event_conflict"}


@pytest.mark.parametrize("changes,reason", [
    ({"instrument_version_id": "missing"}, "unknown_instrument_version"),
    ({"source_id": "different-venue"}, "source_instrument_mismatch"),
    ({"event_at": NOW + timedelta(seconds=1),
      "received_at": NOW + timedelta(seconds=2)}, "event_after_cutoff"),
    ({"available_at": NOW + timedelta(milliseconds=1),
      "received_at": NOW + timedelta(milliseconds=1)}, "unavailable_at_cutoff"),
    ({"event_at": NOW - timedelta(seconds=10)}, "stale_at_cutoff"),
    ({"finality": "reorged"}, "finality_reorged"),
    ({"finality": "confirmed"}, "snapshot_only_finality_claim"),
])
def test_corrupt_or_unavailable_observation_has_explicit_reason(changes, reason):
    result = replay([book(**changes)])
    assert result.accepted_observation_hashes == ()
    assert [row.reason for row in result.excluded] == [reason]


def test_future_event_relative_to_cutoff_never_appears_in_snapshot():
    value = book(event_at=NOW + timedelta(milliseconds=1),
        received_at=NOW + timedelta(milliseconds=2), available_at=NOW)
    result = replay([value])
    assert result.accepted_observation_hashes == ()
    assert result.excluded


def test_sequence_gap_quarantines_sequenced_books_but_not_snapshot_only_feed():
    one = book(event_id="seq-1", continuity="sequenced", sequence=1, finality="confirmed")
    three = book(event_id="seq-3", continuity="sequenced", sequence=3,
        finality="confirmed", raw_payload_hash="b" * 64)
    snapshot_only = book("venue-b", "snapshot")
    result = replay([three, snapshot_only, one], [instrument(), instrument("venue-b")])
    assert result.has_gap is True
    assert {row.reason for row in result.excluded} == {"sequence_gap"}
    assert result.instrument_version_ids == ("venue-b:BTC-USD:v1",)


def test_same_stream_sequence_cannot_name_two_different_source_events():
    first = book(event_id="seq-1a", continuity="sequenced", sequence=1,
        finality="confirmed", raw_payload_hash="a" * 64)
    second = book(event_id="seq-1b", continuity="sequenced", sequence=1,
        finality="confirmed", raw_payload_hash="b" * 64)
    result = replay([first, second])
    assert result.accepted_observation_hashes == ()
    assert len(result.excluded) == 2


@pytest.mark.parametrize("bids,asks", [
    ((BookLevel(price_quote_per_base="25002", size_base="0.01"),),
     (BookLevel(price_quote_per_base="25001", size_base="0.02"),)),
    ((BookLevel(price_quote_per_base="25000", size_base="0.01"),
      BookLevel(price_quote_per_base="25002", size_base="0.01")),
     (BookLevel(price_quote_per_base="25003", size_base="0.02"),)),
])
def test_crossed_or_unsorted_book_is_never_admitted(bids, asks):
    result = replay([book(bids=bids, asks=asks)])
    assert result.accepted_observation_hashes == ()
    assert result.excluded


def test_book_quantity_cannot_exceed_instrument_native_size_precision():
    value = book(bids=(BookLevel(price_quote_per_base="25000",
        size_base="0.000000001"),))
    result = replay([value])
    assert result.accepted_observation_hashes == ()
    assert result.excluded


def test_recorded_source_without_approved_rights_cannot_be_admitted():
    value = book(source_kind="recorded_native", source_rights_ref="unapproved")
    result = replay([value])
    assert result.accepted_observation_hashes == ()
    assert {row.reason for row in result.excluded} == {"source_rights_unapproved"}


def test_large_exact_book_size_has_deterministic_outcome_without_decimal_context_error():
    size = "123456789012345678901234567890.00000001"
    value = book(bids=(BookLevel(price_quote_per_base="25000", size_base=size),))
    result = replay([value])
    assert len(result.accepted_observation_hashes) + len(result.excluded) == 1


def test_instrument_step_cannot_claim_more_precision_than_native_size():
    with pytest.raises(ValueError):
        instrument(size_decimals=8, lot_step="0.000000001")


def test_recorded_book_cannot_use_unreviewed_price_rule():
    value = book(source_kind="recorded_native",
        source_rights_ref="internal_qualification_only")
    result = replay([value], [instrument(price_rule="unreviewed_rule")])
    assert result.accepted_observation_hashes == ()
    assert result.excluded
