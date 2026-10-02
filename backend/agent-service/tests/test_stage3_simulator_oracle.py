"""Black-box deterministic source facts against frozen partial spot hand arithmetic."""
from datetime import timedelta

import pytest

from moeazi_agent.lifecycle_run_contracts import simulation_dataset_hash
from moeazi_agent.lifecycle_simulator import (
    MODEL_HASH, MODEL_VERSION, simulate_order,
)
from moeazi_agent.observation_contracts import BookLevel
from test_stage2_observation_replay import NOW, book, instrument
from test_stage3_lifecycle_contracts import H, permit
from test_stage3_run_contracts import scenario


def observations():
    first = book(event_id="first", source_kind="documented_example",
        source_rights_ref="documentation_example_only",
        bids=(BookLevel(price_quote_per_base="24999", size_base="0.4"),),
        asks=(BookLevel(price_quote_per_base="25000", size_base="0.4"),))
    second = book(event_id="second", source_kind="documented_example",
        source_rights_ref="documentation_example_only",
        event_at=NOW + timedelta(milliseconds=50),
        available_at=NOW + timedelta(milliseconds=100),
        received_at=NOW + timedelta(milliseconds=100),
        bids=(BookLevel(price_quote_per_base="25999", size_base="0.4"),),
        asks=(BookLevel(price_quote_per_base="26000", size_base="0.4"),))
    return first, second


def scenario_for(rows, **changes):
    body = dict(model_version=MODEL_VERSION, model_hash=MODEL_HASH,
        dataset_hash=simulation_dataset_hash(rows),
        simulation_cursor_at=NOW,
        simulation_end_at=NOW + timedelta(seconds=2),
        evidence_cutoff_at=NOW,
        latency_ms=25, cancel_latency_ms=50,
        depth_participation_bps=2500, fee_bps=10,
        funding_rules=(), fee_rules=({"order_ordinal": 1,
            "fill_ordinal": 2, "asset_unit_id": "ETH:18",
            "registry_hash": H, "units": "1000000000000000"},),
        outcome_rules=({"order_ordinal": 1,
            "source_event_id": "cancel-after-partial", "kind": "cancelled",
            "at_cursor": NOW + timedelta(seconds=1)},))
    return scenario(**(body | changes))


def permit_for(definition, **changes):
    body = dict(instrument_version_id=definition.instrument_version_id,
        instrument_registry_hash=definition.registry_hash,
        quantity_asset_unit_id=definition.base_asset_unit_id,
        quote_asset_unit_id=definition.quote_asset_unit_id,
        settlement_asset_unit_id=definition.settlement_asset_unit_id,
        quantity_units="30000000", issued_at_cursor=NOW,
        valid_until_cursor=NOW + timedelta(seconds=2))
    return permit(**(body | changes))


def test_two_partial_fills_exact_native_amounts_third_asset_fee_and_cancel():
    definition = instrument()
    rows = observations()
    source = scenario_for(rows)
    request = permit_for(definition)
    events = simulate_order(request, definition, rows, source)
    assert [row.kind for row in events] == [
        "accepted", "fill", "fill", "cancel_requested", "cancelled"]
    fills = [row for row in events if row.kind == "fill"]
    assert [(row.fill_quantity_units, row.cumulative_filled_units)
            for row in fills] == [("10000000", "10000000"),
                                 ("10000000", "20000000")]
    assert [(row.price_numerator, row.price_denominator)
            for row in fills] == [("250", "1"), ("260", "1")]
    assert [(row.fee_asset_unit_id, row.fee_units) for row in fills] == [
        (definition.quote_asset_unit_id, "2500000"),
        ("ETH:18", "1000000000000000")]
    assert sum(int(row.fill_quantity_units) for row in fills) == 20_000_000
    assert int(request.quantity_units) - int(events[-1].cumulative_filled_units) == \
        10_000_000  # cancelled remainder, not a closed 0.2 BTC position
    assert len({row.source_event_id for row in events}) == len(events)
    assert tuple(row.event_hash for row in events) == tuple(row.event_hash for row in
        simulate_order(request, definition, rows, source))


def test_frozen_dataset_or_unsupported_queue_cannot_be_reinterpreted():
    definition = instrument()
    rows = observations()
    source = scenario_for(rows)
    request = permit_for(definition)
    with pytest.raises(ValueError, match="dataset differs"):
        simulate_order(request, definition, tuple(reversed(rows)), source)
    with pytest.raises(ValueError, match="queue priority"):
        simulate_order(request, definition, rows,
                       scenario_for(rows, queue_model="recorded_sequence"))


def test_partial_fill_does_not_use_undocumented_or_late_book():
    definition = instrument()
    rows = observations()
    wrong_rights = (rows[0].model_copy(update={
        "source_rights_ref": "unapproved"}), rows[1])
    with pytest.raises(ValueError, match="inadmissible"):
        simulate_order(permit_for(definition), definition, wrong_rights,
                       scenario_for(wrong_rights))
    late = (rows[0], rows[1].model_copy(update={
        "available_at": NOW + timedelta(seconds=3),
        "received_at": NOW + timedelta(seconds=3)}))
    events = simulate_order(permit_for(definition), definition, late,
                            scenario_for(late))
    fills = [item for item in events if item.kind == "fill"]
    assert len(fills) == 1 and fills[0].fill_quantity_units == "10000000"


def test_old_book_cannot_authorize_a_later_simulated_dispatch():
    definition = instrument()
    rows = observations()
    source = scenario_for(rows,
        simulation_cursor_at=NOW + timedelta(seconds=10),
        evidence_cutoff_at=NOW + timedelta(seconds=9),
        simulation_end_at=NOW + timedelta(seconds=12),
        outcome_rules=())
    request = permit_for(definition,
        issued_at_cursor=NOW + timedelta(seconds=10),
        valid_until_cursor=NOW + timedelta(seconds=12))
    with pytest.raises(ValueError, match="stale|age|fresh"):
        simulate_order(request, definition, rows, source)
