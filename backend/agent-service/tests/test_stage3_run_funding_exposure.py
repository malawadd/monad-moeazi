"""Funding is payable only while a linear-perp exposure actually exists."""
from datetime import timedelta

import pytest

from moeazi_agent.lifecycle_replay import simulate_run
from test_stage2_observation_replay import NOW, instrument
from test_stage3_perp_simulator_oracle import perp_book, perp_definition, perp_permit
from test_stage3_replay_protection import bound
from test_stage3_run_contracts import manifest
from test_stage3_simulator_oracle import observations, scenario_for
from test_stage3_position_math_oracle import order


def funding(ordinal, definition):
    return {"order_ordinal": ordinal,
            "source_event_id": f"payment-{ordinal}",
            "instrument_version_id": definition.instrument_version_id,
            "at_cursor": NOW + timedelta(seconds=1),
            "asset_unit_id": definition.settlement_asset_unit_id,
            "registry_hash": definition.registry_hash,
            "signed_units": "-3000000"}


def run_for(definition, rows, frozen):
    return manifest(scenario=frozen,
        instrument_version_ids=(definition.instrument_version_id,))


def test_configured_payment_on_flat_perp_is_rejected_even_if_order_was_accepted():
    definition = perp_definition()
    rows = (perp_book(25_000, "buy", "flat-perp"),)
    frozen = scenario_for(rows, fee_rules=(), outcome_rules=(),
        funding_rules=(funding(1, definition),), depth_participation_bps=1)
    run = run_for(definition, rows, frozen)
    opening = bound(perp_permit(definition, 1, "perp_open", "buy", 10), run)
    with pytest.raises(ValueError, match="funding|flat|exposure"):
        simulate_run(run, (opening,), (definition,), rows)


def test_spot_order_cannot_emit_funding_payment():
    definition = instrument()
    rows = observations()[:1]
    frozen = scenario_for(rows, fee_rules=(), outcome_rules=(),
        funding_rules=(funding(1, definition),))
    run = run_for(definition, rows, frozen)
    spot = bound(order(definition, 1, "spot_buy", "buy", 10_000_000), run)
    with pytest.raises(ValueError, match="funding|spot|perpetual"):
        simulate_run(run, (spot,), (definition,), rows)


def test_rejected_increase_can_pay_funding_on_prior_open_exposure():
    definition = perp_definition()
    rows = (perp_book(25_000, "buy", "prior-open"),)
    frozen = scenario_for(rows, fee_rules=(),
        funding_rules=(funding(2, definition),),
        outcome_rules=({"order_ordinal": 2,
            "source_event_id": "increase-rejected", "kind": "rejected",
            "at_cursor": NOW + timedelta(milliseconds=100)},))
    run = run_for(definition, rows, frozen)
    first = bound(perp_permit(definition, 1, "perp_open", "buy", 10), run)
    second = bound(perp_permit(definition, 2, "perp_increase", "buy", 5), run)
    events = simulate_run(run, (first, second), (definition,), rows)
    assert [(item.order_ordinal, item.kind) for item in events
            if item.kind in {"fill", "funding", "rejected"}] == [
                (1, "fill"), (2, "rejected"), (2, "funding")]
