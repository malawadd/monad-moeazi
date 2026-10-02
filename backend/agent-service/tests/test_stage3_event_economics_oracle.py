"""Hand-calculated native-unit journal postings for Q4 simulated economic facts."""
from datetime import timedelta

from moeazi_agent.lifecycle_event_economics import build_event_economics
from moeazi_agent.lifecycle_events import ExecutionEvent
from moeazi_agent.lifecycle_position_math import empty_position_state
from test_stage2_observation_replay import NOW, instrument
from test_stage3_lifecycle_contracts import H, event, seal
from test_stage3_perp_simulator_oracle import perp_definition
from test_stage3_position_math_oracle import fill, order


def sourced(value):
    return seal(ExecutionEvent, "moeazi-execution-event-v1", "event_hash",
        {key: getattr(value, key) for key in ExecutionEvent.model_fields
         if key != "event_hash"} | {
            "source_stream": "moeazi_simulation_synthetic_v1"})


def postings(command):
    result = {(row.asset_unit_id, row.book): int(row.units)
              for row in command.postings}
    assert len(result) == len(command.postings)
    assert all(row.location_id == "wallet" and row.registry_hash == H
               for row in command.postings)
    for asset in {key[0] for key in result}:
        assert sum(units for (item, _), units in result.items()
                   if item == asset) == 0
    return result


def journal(state, request, source, definition, margin, revision):
    fact = sourced(source)
    effect, command = build_event_economics(fact, request, definition, state,
        margin_bps=margin, expected_revision=revision, writer_epoch=3)
    assert command.source_event_id == fact.source_event_id
    assert command.source_payload_hash == fact.source_payload_hash
    assert command.idempotency_key == f"simulation-event:{fact.event_hash}"
    return effect.new_state, postings(command)


def test_spot_buy_buy_with_third_asset_fee_sell_and_close_post_exact_books():
    definition = instrument()
    btc, usd, eth = definition.base_asset_unit_id, definition.quote_asset_unit_id, "ETH:18"
    requests = [order(definition, i, action, side, 10_000_000)
                for i, action, side in ((1, "spot_buy", "buy"),
                    (2, "spot_buy", "buy"), (3, "spot_sell", "sell"),
                    (4, "spot_sell", "sell"))]
    sources = [fill(req, index, 10_000_000, price, fee,
                    fee_asset=eth if index == 2 else None)
               for index, (req, price, fee) in enumerate(zip(requests,
                   (25_000, 26_000, 27_000, 26_800),
                   (2_500_000, 1_000_000_000_000_000, 2_700_000, 2_680_000)), 1)]
    expected = [
        {(btc, "wallet"): 10_000_000, (btc, "external"): -10_000_000,
         (usd, "wallet"): -2_502_500_000, (usd, "external"): 2_500_000_000,
         (usd, "fees"): 2_500_000},
        {(btc, "wallet"): 10_000_000, (btc, "external"): -10_000_000,
         (usd, "wallet"): -2_600_000_000, (usd, "external"): 2_600_000_000,
         (eth, "wallet"): -1_000_000_000_000_000,
         (eth, "fees"): 1_000_000_000_000_000},
        {(btc, "wallet"): -10_000_000, (btc, "external"): 10_000_000,
         (usd, "wallet"): 2_697_300_000, (usd, "external"): -2_700_000_000,
         (usd, "fees"): 2_700_000},
        {(btc, "wallet"): -10_000_000, (btc, "external"): 10_000_000,
         (usd, "wallet"): 2_677_320_000, (usd, "external"): -2_680_000_000,
         (usd, "fees"): 2_680_000},
    ]
    state = empty_position_state(requests[0], definition)
    for index, (request, fact, wanted) in enumerate(zip(requests, sources, expected)):
        state, actual = journal(state, request, fact, definition, 0, 10 + index)
        assert actual == wanted
    assert state.signed_quantity_units == "0"


def test_linear_perp_open_increase_funding_reduce_close_post_exact_books():
    definition = perp_definition(margin_model="linear_v1")
    usd = definition.settlement_asset_unit_id
    requests = [order(definition, i, action, side, quantity, contracts=True)
                for i, action, side, quantity in (
                    (1, "perp_open", "buy", 10),
                    (2, "perp_increase", "buy", 5),
                    (3, "perp_reduce", "sell", 6),
                    (4, "perp_close", "sell", 9))]
    facts = [fill(req, index, quantity, price, fee) for index,
             (req, quantity, price, fee) in enumerate(zip(requests,
                 (10, 5, 6, 9), (25_000, 26_000, 27_000, 28_000),
                 (2_500_000, 1_300_000, 1_620_000, 2_520_000)), 1)]
    expected = [
        {(usd, "wallet"): -502_500_000, (usd, "collateral"): 500_000_000,
         (usd, "fees"): 2_500_000},
        {(usd, "wallet"): -261_300_000, (usd, "collateral"): 260_000_000,
         (usd, "fees"): 1_300_000},
        {(usd, "collateral"): -3_000_000, (usd, "funding"): 3_000_000},
        {(usd, "wallet"): 302_380_000, (usd, "collateral"): -204_000_000,
         (usd, "fees"): 1_620_000, (usd, "external"): -100_000_000},
        {(usd, "wallet"): 790_480_000, (usd, "collateral"): -553_000_000,
         (usd, "fees"): 2_520_000, (usd, "external"): -240_000_000},
    ]
    state = empty_position_state(requests[0], definition)
    wallet = 10_000_000_000
    cursor = 0
    for index, (request, fact) in enumerate(zip(requests, facts)):
        if index == 2:
            funding = event(instrument_version_id=definition.instrument_version_id,
                order_id=requests[1].order_id, order_ordinal=2,
                client_id=requests[1].client_id, attempt_id=requests[1].attempt_id,
                permit_hash=requests[1].permit_hash, source_event_id="journal-funding",
                sequence=9, kind="funding", quantity_kind="contracts",
                contract_size_unit_id=definition.base_asset_unit_id,
                contract_size_units="1000000", event_at=NOW,
                available_at=NOW + timedelta(milliseconds=1),
                simulation_cursor_at=NOW + timedelta(milliseconds=2),
                fill_quantity_units=None, price_numerator=None,
                price_denominator=None, fee_asset_unit_id=None,
                fee_registry_hash=None, fee_units=None,
                funding_asset_unit_id=usd, funding_registry_hash=H,
                funding_units="-3000000")
            state, actual = journal(state, requests[1], funding, definition,
                                    2_000, 20 + cursor)
            assert actual == expected[cursor]
            cursor += 1
        state, actual = journal(state, request, fact, definition, 2_000,
                                20 + cursor)
        assert actual == expected[cursor]
        wallet += actual[(usd, "wallet")]
        cursor += 1
    assert wallet == 10_329_060_000
    assert state.collateral_units == "0"
    assert state.signed_quantity_units == "0"
