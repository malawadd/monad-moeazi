"""Independent native-unit replay-sizing oracles; receipts grant no SQL authority."""
from datetime import timedelta

import pytest

from moeazi_agent.account_observation_storage import account_snapshot_hash
from moeazi_agent.finance_observation_contracts import (
    AccountObservationSnapshotRef, ObservedBalance, ObservedPosition,
)
from moeazi_agent.lifecycle_decision import build_replay_decision
from moeazi_agent.lifecycle_position_math import empty_position_state
from moeazi_agent.lifecycle_replay_sizing import build_replay_sizing_receipt
from moeazi_agent.lifecycle_run_contracts import simulation_dataset_hash
from moeazi_agent.lifecycle_simulator import MODEL_HASH, MODEL_VERSION
from moeazi_agent.observation_contracts import BookLevel
from moeazi_agent.observation_replay import replay_observations
from test_stage2_finance_policy import policy
from test_stage2_observation_replay import NOW, book, instrument
from test_stage3_lifecycle_contracts import H, permit
from test_stage3_run_contracts import manifest, scenario


def _frozen(*, perpetual=False, base_units=0, contracts=0,
            gross_cap="10000000000", eth_fee=False):
    definition = instrument(**(dict(product_kind="perpetual",
        contract_multiplier="0.01", margin_model="linear_v1",
        funding_model="linear") if perpetual else {}))
    selected = book(event_id="independent-replay-size",
        source_kind="documented_example",
        source_rights_ref="documentation_example_only")
    dataset = (selected,)
    evidence = replay_observations((definition,), dataset, NOW, 5000)
    rules = ({"order_ordinal": 1, "fill_ordinal": 1,
        "asset_unit_id": "ETH:18", "registry_hash": H,
        "units": "1000000000000000"},) if eth_fee else ()
    assumptions = scenario(model_version=MODEL_VERSION, model_hash=MODEL_HASH,
        dataset_hash=simulation_dataset_hash(dataset),
        evidence_cutoff_at=NOW, simulation_cursor_at=NOW,
        simulation_end_at=NOW + timedelta(seconds=2),
        fee_rules=rules, funding_rules=(), outcome_rules=())
    approved = policy(instrument_version_id=definition.instrument_version_id,
        max_quantity_units="100000000" if not perpetual else "100",
        min_quantity_units="1", quantity_step_units="1",
        max_gross_notional_units=gross_cap,
        max_directional_notional_units=gross_cap,
        initial_margin_bps=2000, fee_ceiling_units="10000000")
    margin = abs(contracts) * 50_000_000
    rows = [ObservedBalance(asset_unit_id=definition.base_asset_unit_id,
                location_id="venue", book="wallet",
                units=str(0 if perpetual else base_units), registry_hash=H),
            ObservedBalance(asset_unit_id=definition.quote_asset_unit_id,
                location_id="venue", book="wallet",
                units=str(10_000_000_000 - margin), registry_hash=H)]
    if perpetual:
        rows.append(ObservedBalance(asset_unit_id=definition.settlement_asset_unit_id,
            location_id="venue", book="collateral", units=str(margin), registry_hash=H))
    if eth_fee:
        rows.append(ObservedBalance(asset_unit_id="ETH:18", location_id="venue",
            book="wallet", units="10000000000000000", registry_hash=H))
    observed_positions = (ObservedPosition(
        instrument_version_id=definition.instrument_version_id,
        location_id="venue", instrument_registry_hash=definition.registry_hash,
        contract_size_unit_id=definition.base_asset_unit_id,
        signed_contracts=str(contracts),
        collateral_asset_unit_id=definition.settlement_asset_unit_id,
        margin_units=str(margin), funding_event_ids=(), fee_event_ids=()),) \
        if perpetual and contracts else ()
    body = dict(scope=manifest().scope, snapshot_hash="0" * 64,
        source_account_id="independent-fixture", status="accepted",
        origin="simulation_derived" if contracts else "recorded_fixture",
        event_at=NOW, available_at=NOW, received_at=NOW, cutoff_at=NOW,
        finality_at=NOW, finality="admitted_final", has_gap=False,
        has_reorg=False, balances_complete=True, positions_complete=True,
        rights_ref="local_simulation_fixture_only", source_event_hash=H,
        source_payload_hash=H, registry_hash=H,
        policy_version=approved.policy_version,
        observed_balances=tuple(rows), observed_positions=observed_positions)
    provisional = AccountObservationSnapshotRef.model_validate(body)
    snapshot = AccountObservationSnapshotRef.model_validate(body | {
        "snapshot_hash": account_snapshot_hash(provisional)})
    run = manifest(scenario=assumptions,
        instrument_version_ids=(definition.instrument_version_id,),
        evidence_snapshot_hash=evidence.snapshot_hash,
        account_snapshot_hash=snapshot.snapshot_hash,
        policy_hash=approved.policy_hash, policy_version=approved.policy_version)
    decision, selected = build_replay_decision(run, dataset, NOW, evidence,
        instrument_version_id=definition.instrument_version_id,
        account_snapshot_hash=snapshot.snapshot_hash)
    positions = ()
    if contracts:
        opening = permit(instrument_version_id=definition.instrument_version_id,
            instrument_registry_hash=definition.registry_hash,
            quantity_kind="contracts", contract_size_unit_id=definition.base_asset_unit_id,
            contract_size_units="1000000", action="perp_open", side="buy",
            quantity_asset_unit_id=definition.base_asset_unit_id,
            quote_asset_unit_id=definition.quote_asset_unit_id,
            settlement_asset_unit_id=definition.settlement_asset_unit_id,
            quantity_units="1")
        state = empty_position_state(opening, definition).model_copy(update={
            "signed_quantity_units": str(contracts),
            "open_cost_numerator": str(abs(contracts) * 250_000_000),
            "margin_reserved_units": str(margin), "collateral_units": str(margin),
            "instrument_registry_hash": definition.registry_hash,
            "location_id": "venue"})
        positions = (state,)
    return run, decision, approved, definition, selected, evidence, dataset, snapshot, positions


def _size(case, *, action, side, desired, pending=(), request="size-1"):
    *first, positions = case
    return build_replay_sizing_receipt(*first, positions, pending,
        request_id=request, action=action, side=side,
        desired_quantity_units=desired, order_ordinal=1, account_revision=7)


def test_spot_third_asset_fee_is_exact_and_pending_buy_consumes_gross_cap():
    case = _frozen(gross_cap="250010000", eth_fee=True)
    first = _size(case, action="spot_buy", side="buy", desired="1000000")
    assert first.quantity_units == "1000000" and first.notional_units == "250010000"
    assert first.target_exposure_units == "1000000"
    assert {(part.asset_unit_id, part.units) for part in first.components} == {
        (case[3].quote_asset_unit_id, "260010000"),
        ("ETH:18", "1000000000000000")}
    assert _size(case, action="spot_buy", side="buy", desired="1000000") == first
    with pytest.raises(ValueError, match="cap|exposure"):
        _size(case, action="spot_buy", side="buy", desired="1000000",
              pending=(first,), request="size-2")


def test_spot_sell_at_or_above_gross_cap_still_holds_inventory_and_fee():
    case = _frozen(base_units=20_000_000, gross_cap="5000000000")
    sold = _size(case, action="spot_sell", side="sell", desired="1000000")
    assert sold.target_exposure_units == "19000000"
    assert sold.notional_units == "250000000"
    assert sold.risk_notional_units == "250010000"
    assert {(part.asset_unit_id, part.units) for part in sold.components} == {
        (case[3].base_asset_unit_id, "1000000"),
        (case[3].quote_asset_unit_id, "10000000")}


def test_short_linear_perpetual_open_and_full_close_keep_margin_separate():
    flat = _frozen(perpetual=True)
    opened = _size(flat, action="perp_open", side="sell", desired="1")
    assert (opened.quantity_kind, opened.contract_size_units,
            opened.target_exposure_units) == ("contracts", "1000000", "-1")
    assert (opened.notional_units, opened.risk_notional_units) == (
        "250000000", "250010000")
    assert [(part.asset_unit_id, part.units) for part in opened.components] == [
        (flat[3].settlement_asset_unit_id, "60002000")]
    short = _frozen(perpetual=True, contracts=-1)
    closed = _size(short, action="perp_close", side="buy", desired="1")
    assert closed.target_exposure_units == "0"
    assert closed.notional_units == "250010000"
    assert [(part.asset_unit_id, part.units) for part in closed.components] == [
        (short[3].settlement_asset_unit_id, "10000000")]


def test_unaccepted_cheaper_book_cannot_change_a_frozen_sizing_decision():
    case = _frozen()
    run, decision, approved, definition, selected, evidence, dataset, snapshot, positions = case
    cheap = selected.model_copy(update={"asks": (
        BookLevel(price_quote_per_base="20000", size_base="0.02"),)})
    with pytest.raises(ValueError, match="accepted decision evidence"):
        build_replay_sizing_receipt(run, decision, approved, definition, cheap,
            evidence, dataset, snapshot, positions, (), request_id="forged-price",
            action="spot_buy", side="buy", desired_quantity_units="1000000",
            order_ordinal=1, account_revision=7)
