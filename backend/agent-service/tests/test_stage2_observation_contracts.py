"""Independent Q2 boundary checks; fixtures are synthetic and confer no live authority."""
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from moeazi_agent.observation_contracts import (
    BookLevel, InstrumentVersion, MarketObservation, ObservedBalance,
)


NOW = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
HASH = "a" * 64


def instrument(venue: str = "venue-a", **changes) -> InstrumentVersion:
    fields = dict(instrument_version_id=f"{venue}:BTC-USD:v1", venue_id=venue,
        native_instrument_id="BTC-USD", product_kind="spot",
        base_asset_unit_id=f"{venue}:BTC:8", quote_asset_unit_id=f"{venue}:USDC:6",
        settlement_asset_unit_id=f"{venue}:USDC:6", base_decimals=8,
        quote_decimals=6, settlement_decimals=6, size_decimals=8,
        contract_multiplier="1", price_rule="quote_per_base", lot_step="0.00000001",
        min_size="0.00001", margin_model="none", funding_model="none",
        effective_at=NOW - timedelta(days=1), registry_hash=HASH)
    return InstrumentVersion(**(fields | changes))


def observation(**changes) -> MarketObservation:
    fields = dict(instrument_version_id="venue-a:BTC-USD:v1", source_id="feed-a",
        source_event_id="book-1", source_kind="synthetic_fault",
        source_rights_ref="fixture-only", raw_payload_hash=HASH,
        observation_kind="book_snapshot", event_at=NOW - timedelta(seconds=2),
        received_at=NOW, available_at=NOW, sequence=None,
        continuity="snapshot_only", finality="not_applicable",
        bids=(BookLevel(price_quote_per_base="25000.123456", size_base="0.01000000"),),
        asks=(BookLevel(price_quote_per_base="25001.123456", size_base="0.02000000"),))
    return MarketObservation(**(fields | changes))


def test_same_display_symbol_does_not_erase_venue_or_asset_unit_identity():
    a, b = instrument("venue-a"), instrument("venue-b")
    assert a.native_instrument_id == b.native_instrument_id == "BTC-USD"
    assert a.instrument_version_id != b.instrument_version_id
    assert a.base_asset_unit_id != b.base_asset_unit_id
    assert a.quote_asset_unit_id != b.quote_asset_unit_id


def test_observation_preserves_event_received_and_available_times():
    value = observation(available_at=NOW + timedelta(milliseconds=500))
    assert value.event_at < value.received_at < value.available_at
    assert value.sequence is None and value.continuity == "snapshot_only"
    assert value.finality == "not_applicable"


@pytest.mark.parametrize("changes", [
    {"sequence": 4},
    {"continuity": "sequenced"},
    {"block_number": 9},
    {"raw_payload_hash": "A" * 64},
    {"event_at": datetime(2026, 9, 30, 12)},
    {"bids": (BookLevel(price_quote_per_base="25000", size_base="0.01"),),
     "asks": ()},
])
def test_observation_rejects_false_continuity_or_malformed_evidence(changes):
    with pytest.raises(ValidationError):
        observation(**changes)


@pytest.mark.parametrize("units", ["1.0", "1e6", "+1", "01", 1.5])
def test_observed_balance_requires_exact_native_integer_strings(units):
    with pytest.raises(ValidationError):
        ObservedBalance(asset_unit_id="USDC:6", location_id="wallet",
            book="wallet", units=units, registry_hash=HASH)


def test_instrument_rejects_float_sizes_and_unknown_identity_fields():
    with pytest.raises(ValidationError):
        instrument(lot_step=0.00000001)
    with pytest.raises(ValidationError):
        instrument(customer_supplied_override="another-venue")


@pytest.mark.parametrize("changes", [
    {"base_decimals": False},
    {"quote_decimals": 6.0},
    {"size_decimals": True},
])
def test_instrument_rejects_coerced_decimal_metadata(changes):
    with pytest.raises(ValidationError):
        instrument(**changes)


def test_observation_rejects_boolean_schema_and_sequence_values():
    with pytest.raises(ValidationError):
        observation(schema_version=True)
    with pytest.raises(ValidationError):
        observation(continuity="sequenced", sequence=True)
