"""Run-level visible depth and protection events remain scoped source facts."""
from datetime import timedelta

import pytest

from moeazi_agent.lifecycle_contracts import ExecutionPermit
from moeazi_agent.lifecycle_replay import simulate_run
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.lifecycle_run_contracts import simulation_dataset_hash
from moeazi_agent.observation_contracts import BookLevel
from test_stage2_observation_replay import NOW, book, instrument
from test_stage3_lifecycle_contracts import seal
from test_stage3_position_math_oracle import order
from test_stage3_run_contracts import manifest
from test_stage3_simulator_oracle import observations, scenario_for


def bound(request, run):
    body = {field: getattr(request, field) for field in ExecutionPermit.model_fields
            if field != "permit_hash"}
    body["run_manifest_hash"] = run.manifest_hash
    return seal(ExecutionPermit, "moeazi-execution-permit-v1", "permit_hash", body)


def protected(definition):
    base = order(definition, 1, "spot_sell", "sell", 10_000_000)
    body = {field: getattr(base, field) for field in ExecutionPermit.model_fields
            if field != "permit_hash"}
    return seal(ExecutionPermit, "moeazi-execution-permit-v1", "permit_hash",
        body | {
            "order_id": "protect-sell-1", "protection_order_id": "protect-sell-1",
            "originating_order_id": "earlier-entry-1"})


@pytest.mark.parametrize("model,kinds", [
    ("confirm", ("accepted", "protection_accepted", "fill")),
    ("reject", ("accepted", "protection_rejected")),
])
def test_protection_requires_separate_permit_and_rejection_never_fills(model, kinds):
    definition = instrument()
    rows = observations()[:1]
    source = scenario_for(rows, fee_rules=(), outcome_rules=(),
                          protection_outcome_model=model)
    request = protected(definition)
    events = simulate_order(request, definition, rows, source)
    assert tuple(item.kind for item in events) == kinds
    if model == "reject":
        assert all(item.fill_quantity_units is None for item in events)
    else:
        assert events[1].protection_order_id == request.order_id
        assert events[2].fill_quantity_units == "10000000"
        assert events[1].simulation_cursor_at <= events[2].simulation_cursor_at


def test_protection_outcome_cannot_attach_to_unprotected_entry():
    definition = instrument()
    rows = observations()[:1]
    source = scenario_for(rows, fee_rules=(),
        outcome_rules=({"order_ordinal": 1, "source_event_id": "fake-protection",
            "kind": "protection_accepted", "at_cursor": NOW + timedelta(seconds=1)},))
    request = order(definition, 1, "spot_buy", "buy", 10_000_000)
    with pytest.raises(ValueError, match="protection outcome"):
        simulate_order(request, definition, rows, source)


def test_two_instrument_run_uses_one_frozen_dataset_without_cross_instrument_book():
    spot = instrument()
    perp = instrument("venue-b", product_kind="perpetual",
        contract_multiplier="0.01", margin_model="linear_v1", funding_model="linear")
    spot_book = observations()[0]
    perp_book = book("venue-b", "perp-book", source_kind="documented_example",
        source_rights_ref="documentation_example_only",
        bids=(BookLevel(price_quote_per_base="24999", size_base="0.4"),),
        asks=(BookLevel(price_quote_per_base="25000", size_base="0.4"),))
    rows = (spot_book, perp_book)
    scenario = scenario_for(rows, fee_rules=(), outcome_rules=(), funding_rules=())
    run = manifest(scenario=scenario,
        instrument_version_ids=(spot.instrument_version_id, perp.instrument_version_id))
    first = bound(order(spot, 1, "spot_buy", "buy", 10_000_000), run)
    second = bound(order(perp, 2, "perp_open", "buy", 10, contracts=True), run)
    events = simulate_run(run, (first, second), (spot, perp), rows)
    fills = [item for item in events if item.kind == "fill"]
    assert [(item.instrument_version_id, item.fill_quantity_units)
            for item in fills] == [(spot.instrument_version_id, "10000000"),
                                   (perp.instrument_version_id, "10")]
    assert all(item.dataset_hash == simulation_dataset_hash(rows) for item in events)


def test_two_orders_cannot_spend_same_visible_book_depth_twice():
    definition = instrument()
    rows = observations()[:1]
    scenario = scenario_for(rows, fee_rules=(), outcome_rules=(), funding_rules=())
    run = manifest(scenario=scenario,
        instrument_version_ids=(definition.instrument_version_id,))
    first = bound(order(definition, 1, "spot_buy", "buy", 10_000_000), run)
    second = bound(order(definition, 2, "spot_buy", "buy", 10_000_000), run)
    assert [item.fill_quantity_units for item in
            simulate_order(first, definition, rows, scenario) if item.kind == "fill"] == ["10000000"]
    with pytest.raises(ValueError, match="overconsume"):
        simulate_run(run, (first, second), (definition,), rows)
