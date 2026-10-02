"""Black-box linear-perp source arithmetic; journal/position authority is separate."""
from datetime import timedelta

import pytest

from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.observation_contracts import BookLevel
from test_stage2_observation_replay import NOW, book, instrument
from test_stage3_lifecycle_contracts import H, permit
from test_stage3_simulator_oracle import scenario_for


def perp_definition(**changes):
    return instrument(**(dict(product_kind="perpetual", contract_multiplier="0.01",
                      margin_model="linear_v1", funding_model="linear") | changes))


def perp_book(price, side, event_id):
    bid = str(price if side == "sell" else price - 1)
    ask = str(price if side == "buy" else price + 1)
    return book(event_id=event_id, source_kind="documented_example",
        source_rights_ref="documentation_example_only",
        bids=(BookLevel(price_quote_per_base=bid, size_base="0.4"),),
        asks=(BookLevel(price_quote_per_base=ask, size_base="0.4"),))


def perp_permit(definition, ordinal, action, side, contracts):
    return permit(order_id=f"perp-order-{ordinal}",
        client_id=f"perp-client-{ordinal}",
        attempt_id=f"perp-attempt-{ordinal}", order_ordinal=ordinal,
        instrument_version_id=definition.instrument_version_id,
        instrument_registry_hash=definition.registry_hash,
        action=action, side=side, quantity_kind="contracts",
        contract_size_unit_id=definition.base_asset_unit_id,
        contract_size_units="1000000",
        quantity_asset_unit_id=definition.base_asset_unit_id,
        quote_asset_unit_id=definition.quote_asset_unit_id,
        settlement_asset_unit_id=definition.settlement_asset_unit_id,
        quantity_units=str(contracts), issued_at_cursor=NOW,
        valid_until_cursor=NOW + timedelta(seconds=2))


@pytest.mark.parametrize("ordinal,action,side,contracts,price,notional,fee", [
    (1, "perp_open", "buy", 10, 25000, 2_500_000_000, 2_500_000),
    (2, "perp_increase", "buy", 5, 26000, 1_300_000_000, 1_300_000),
    (3, "perp_reduce", "sell", 6, 27000, 1_620_000_000, 1_620_000),
    (4, "perp_close", "sell", 9, 28000, 2_520_000_000, 2_520_000),
])
def test_linear_perp_exact_contract_notional_fee_and_funding_source(
        ordinal, action, side, contracts, price, notional, fee):
    definition = perp_definition()
    rows = (perp_book(price, side, f"perp-book-{ordinal}"),)
    funding = ({"order_ordinal": 2, "source_event_id": "funding-3-usdc",
        "instrument_version_id": definition.instrument_version_id,
        "at_cursor": NOW + timedelta(seconds=1),
        "asset_unit_id": definition.settlement_asset_unit_id,
        "registry_hash": H, "signed_units": "-3000000"},) if ordinal == 2 else ()
    source = scenario_for(rows, fee_rules=(), outcome_rules=(),
                          funding_rules=funding)
    request = perp_permit(definition, ordinal, action, side, contracts)
    events = simulate_order(request, definition, rows, source)
    fills = [row for row in events if row.kind == "fill"]
    assert len(fills) == 1
    fill = fills[0]
    assert fill.fill_quantity_units == str(contracts)
    assert fill.cumulative_filled_units == str(contracts)
    assert fill.contract_size_units == "1000000"
    assert fill.contract_size_unit_id == definition.base_asset_unit_id
    assert (int(fill.price_numerator) * contracts * 1_000_000 //
            int(fill.price_denominator)) == notional
    assert fill.fee_asset_unit_id == definition.quote_asset_unit_id
    assert fill.fee_units == str(fee)
    facts = [row for row in events if row.kind == "funding"]
    if ordinal == 2:
        assert [(row.funding_asset_unit_id, row.funding_units)
                for row in facts] == [(definition.settlement_asset_unit_id, "-3000000")]
    else:
        assert facts == []


def test_inverse_margin_model_cannot_inherit_linear_parity():
    definition = perp_definition(margin_model="inverse")
    rows = (perp_book(25000, "buy", "inverse-book"),)
    source = scenario_for(rows, fee_rules=(), outcome_rules=(), funding_rules=())
    request = perp_permit(definition, 1, "perp_open", "buy", 10)
    with pytest.raises(ValueError, match="unsupported|linear"):
        simulate_order(request, definition, rows, source)
