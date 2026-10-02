"""Independent native-unit spot and linear-perp arithmetic oracle."""
from datetime import timedelta

import pytest

from moeazi_agent.lifecycle_position_math import (
    calculate_fill_effect, calculate_funding_effect, empty_position_state,
)
from test_stage2_observation_replay import NOW, instrument
from test_stage3_lifecycle_contracts import H, event, permit
from test_stage3_perp_simulator_oracle import perp_definition


def order(definition, ordinal, action, side, quantity, *, contracts=False):
    return permit(order_id=f"math-order-{ordinal}",
        client_id=f"math-client-{ordinal}", attempt_id=f"math-attempt-{ordinal}",
        order_ordinal=ordinal, instrument_version_id=definition.instrument_version_id,
        instrument_registry_hash=definition.registry_hash, action=action, side=side,
        quantity_kind="contracts" if contracts else "asset_native",
        contract_size_unit_id=definition.base_asset_unit_id if contracts else None,
        contract_size_units="1000000" if contracts else None,
        quantity_asset_unit_id=definition.base_asset_unit_id,
        quote_asset_unit_id=definition.quote_asset_unit_id,
        settlement_asset_unit_id=definition.settlement_asset_unit_id,
        quantity_units=str(quantity), issued_at_cursor=NOW,
        valid_until_cursor=NOW + timedelta(seconds=2))


def fill(request, ordinal, quantity, price, fee, *, fee_asset=None):
    return event(instrument_version_id=request.instrument_version_id,
        order_id=request.order_id, order_ordinal=request.order_ordinal,
        client_id=request.client_id, attempt_id=request.attempt_id,
        permit_hash=request.permit_hash, source_event_id=f"math-fill-{ordinal}",
        sequence=ordinal, quantity_kind=request.quantity_kind,
        contract_size_unit_id=request.contract_size_unit_id,
        contract_size_units=request.contract_size_units,
        event_at=NOW, available_at=NOW + timedelta(milliseconds=1),
        simulation_cursor_at=NOW + timedelta(milliseconds=2),
        fill_quantity_units=str(quantity), cumulative_filled_units=str(quantity),
        price_numerator=str(price // 100), price_denominator="1",
        fee_asset_unit_id=fee_asset or request.quote_asset_unit_id,
        fee_registry_hash=H, fee_units=str(fee))


def wallet(effect, asset):
    return sum(int(row.units) for row in effect.deltas
               if row.asset_unit_id == asset and row.book == "wallet")


def test_spot_partial_buys_third_asset_fee_reduce_close_exact():
    definition = instrument()
    first = order(definition, 1, "spot_buy", "buy", 10_000_000)
    state = empty_position_state(first, definition)
    assert state.signed_quantity_units == "0"
    cases = (
        (first, fill(first, 1, 10_000_000, 25_000, 2_500_000),
         "10000000", "2500000000", "0", "-2502500000"),
        (order(definition, 2, "spot_buy", "buy", 10_000_000), None,
         "20000000", "5100000000", "0", "-2600000000"),
        (order(definition, 3, "spot_sell", "sell", 10_000_000), None,
         "10000000", "2550000000", "150000000", "2697300000"),
        (order(definition, 4, "spot_sell", "sell", 10_000_000), None,
         "0", "0", "280000000", "2677320000"),
    )
    fees = (2_500_000, 1_000_000_000_000_000, 2_700_000, 2_680_000)
    prices = (25_000, 26_000, 27_000, 26_800)
    for index, (request, fixed, quantity, basis, realized, quote_delta) in enumerate(cases):
        source = fixed or fill(request, index + 1, 10_000_000, prices[index],
                               fees[index], fee_asset="ETH:18" if index == 1 else None)
        effect = calculate_fill_effect(state, request, source, definition, margin_bps=0)
        state = effect.new_state
        assert state.signed_quantity_units == quantity
        assert state.open_cost_numerator == basis
        assert state.open_cost_denominator == "1"
        assert state.realized_pnl_numerator == realized
        assert wallet(effect, definition.quote_asset_unit_id) == int(quote_delta)
        assert wallet(effect, definition.base_asset_unit_id) == (
            10_000_000 if index < 2 else -10_000_000)
    assert [(row.asset_unit_id, row.signed_units) for row in state.fee_totals] == [
        ("ETH:18", "1000000000000000"),
        (definition.quote_asset_unit_id, "7880000")]
    assert state.unrealized_pnl_numerator == "0"


def test_linear_perp_open_increase_funding_reduce_close_exact():
    definition = perp_definition(margin_model="linear_v1")
    first = order(definition, 1, "perp_open", "buy", 10, contracts=True)
    state = empty_position_state(first, definition)
    steps = (
        (first, 10, 25_000, 2_500_000, "10", "2500000000", "500000000", "500000000", "0"),
        (order(definition, 2, "perp_increase", "buy", 5, contracts=True),
         5, 26_000, 1_300_000, "15", "3800000000", "760000000", "760000000", "0"),
        (order(definition, 3, "perp_reduce", "sell", 6, contracts=True),
         6, 27_000, 1_620_000, "9", "2280000000", "456000000", "553000000", "100000000"),
        (order(definition, 4, "perp_close", "sell", 9, contracts=True),
         9, 28_000, 2_520_000, "0", "0", "0", "0", "340000000"),
    )
    wallet_total = 10_000_000_000
    for index, (request, quantity, price, fee, open_qty, basis, margin, collateral, realized) in enumerate(steps):
        if index == 2:
            funding = event(instrument_version_id=definition.instrument_version_id,
                order_id=steps[1][0].order_id, order_ordinal=2,
                client_id=steps[1][0].client_id, attempt_id=steps[1][0].attempt_id,
                permit_hash=steps[1][0].permit_hash, source_event_id="math-funding",
                sequence=9, kind="funding", quantity_kind="contracts",
                contract_size_unit_id=definition.base_asset_unit_id,
                contract_size_units="1000000", event_at=NOW,
                available_at=NOW + timedelta(milliseconds=1),
                simulation_cursor_at=NOW + timedelta(milliseconds=2),
                fill_quantity_units=None, price_numerator=None,
                price_denominator=None, fee_asset_unit_id=None,
                fee_registry_hash=None, fee_units=None,
                funding_asset_unit_id=definition.settlement_asset_unit_id,
                funding_registry_hash=H, funding_units="-3000000")
            state = calculate_funding_effect(state, funding, definition).new_state
            assert state.collateral_units == "757000000"
        effect = calculate_fill_effect(state, request,
            fill(request, index + 1, quantity, price, fee), definition,
            margin_bps=2_000)
        state = effect.new_state
        wallet_total += wallet(effect, definition.settlement_asset_unit_id)
        assert (state.signed_quantity_units, state.open_cost_numerator,
                state.margin_reserved_units, state.collateral_units,
                state.realized_pnl_numerator) == (
                    open_qty, basis, margin, collateral, realized)
        if index == 1:
            assert wallet_total == 9_236_200_000
        if index == 2:
            assert wallet_total == 9_538_580_000
    assert wallet_total == 10_329_060_000
    assert state.unrealized_pnl_numerator == "0"
    assert state.funding_totals[0].signed_units == "-3000000"
    assert state.fee_totals[0].signed_units == "7940000"


def test_over_sell_and_unsupported_margin_model_fail_closed():
    spot = instrument()
    request = order(spot, 1, "spot_sell", "sell", 10_000_000)
    with pytest.raises(ValueError, match="inventory"):
        calculate_fill_effect(empty_position_state(request, spot), request,
            fill(request, 1, 10_000_000, 25_000, 0), spot, margin_bps=0)
    inverse = perp_definition(margin_model="inverse")
    request = order(inverse, 1, "perp_open", "buy", 10, contracts=True)
    with pytest.raises(ValueError, match="unsupported"):
        calculate_fill_effect(empty_position_state(request, inverse), request,
            fill(request, 1, 10, 25_000, 2_500_000), inverse, margin_bps=2_000)


def test_partial_perp_close_retains_exposure_and_margin_obligation():
    definition = perp_definition(margin_model="linear_v1")
    opening = order(definition, 1, "perp_open", "buy", 10, contracts=True)
    state = calculate_fill_effect(empty_position_state(opening, definition), opening,
        fill(opening, 1, 10, 25_000, 2_500_000), definition,
        margin_bps=2_000).new_state
    closing = order(definition, 2, "perp_close", "sell", 10, contracts=True)
    partial = calculate_fill_effect(state, closing,
        fill(closing, 2, 4, 26_000, 1_040_000), definition,
        margin_bps=2_000).new_state
    assert (partial.signed_quantity_units, partial.open_cost_numerator,
            partial.realized_pnl_numerator, partial.margin_reserved_units,
            partial.collateral_units) == (
                "6", "1500000000", "40000000", "300000000", "340000000")


def test_fractional_realized_gain_posts_cumulative_truncation_difference():
    definition = perp_definition(margin_model="linear_v1")
    first = order(definition, 1, "perp_open", "buy", 2, contracts=True)
    state = calculate_fill_effect(empty_position_state(first, definition), first,
        fill(first, 1, 2, 25_000, 0), definition,
        margin_bps=2_000).new_state
    increase = order(definition, 2, "perp_increase", "buy", 1, contracts=True)
    state = calculate_fill_effect(state, increase,
        fill(increase, 2, 1, 25_100, 0), definition,
        margin_bps=2_000).new_state
    posted = []
    for ordinal in (3, 4):
        reduce = order(definition, ordinal, "perp_reduce", "sell", 1,
                       contracts=True)
        prior_margin = int(state.margin_reserved_units)
        prior_collateral = int(state.collateral_units)
        effect = calculate_fill_effect(state, reduce,
            fill(reduce, ordinal, 1, 25_200, 0), definition,
            margin_bps=2_000)
        state = effect.new_state
        released_margin = prior_margin - int(state.margin_reserved_units)
        posted.append(int(state.collateral_units) - prior_collateral + released_margin)
    assert posted == [1_666_666, 1_666_667]
    assert (state.realized_pnl_numerator, state.realized_pnl_denominator) == (
        "10000000", "3")
