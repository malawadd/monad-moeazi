"""Product-owned pure Q4 receipt smoke; SQL admission is tested separately."""
import json
from datetime import timedelta
from types import SimpleNamespace

import pytest

from moeazi_agent.account_observation_storage import account_snapshot_hash
from moeazi_agent.finance_contracts import _digest
from moeazi_agent.finance_observation_contracts import (
    AccountObservationSnapshotRef, ObservedBalance, ObservedPosition,
)
from moeazi_agent.lifecycle_decision import build_replay_decision
from moeazi_agent.lifecycle_position_math import empty_position_state
from moeazi_agent.lifecycle_replay_sizing import build_replay_sizing_receipt
from moeazi_agent.lifecycle_replay_finance_contracts import ReplaySizingReceipt
from moeazi_agent.lifecycle_order_replay_preflight import preflight_replay_order
from moeazi_agent.lifecycle_run_contracts import simulation_dataset_hash
from moeazi_agent.lifecycle_simulator import MODEL_HASH, MODEL_VERSION
from moeazi_agent.observation_contracts import BookLevel
from moeazi_agent.observation_replay import replay_observations
from test_stage2_finance_policy import policy
from test_stage2_observation_replay import NOW, instrument
from test_stage3_run_contracts import manifest, scenario
from test_stage3_strategy_signal_boundary import admitted
from test_stage3_perp_simulator_oracle import (
    perp_book, perp_definition, perp_permit,
)

H = "a" * 64


def case(*, fee_asset="ETH:18", wallet_rows=(), include_eth=True,
         base_units="0", gross_cap="25000000000"):
    definition = instrument()
    book = admitted()
    evidence = replay_observations((definition,), (book,), NOW, 5_000)
    rules = ({"order_ordinal": 1, "fill_ordinal": 2,
              "asset_unit_id": fee_asset, "registry_hash": H,
              "units": "1000000000000000"},)
    source = scenario(model_hash=MODEL_HASH, model_version=MODEL_VERSION,
        dataset_hash=simulation_dataset_hash((book,)),
        evidence_cutoff_at=NOW, simulation_cursor_at=NOW,
        simulation_end_at=NOW + timedelta(seconds=2),
        fee_rules=rules, funding_rules=(), outcome_rules=())
    approved = policy(instrument_version_id=definition.instrument_version_id,
        max_quantity_units="100000000", max_gross_notional_units=gross_cap,
        max_directional_notional_units=gross_cap,
        fee_ceiling_units="10000000", min_quantity_units="1",
        quantity_step_units="1")
    balances = (
        ObservedBalance(asset_unit_id=definition.base_asset_unit_id,
            location_id="venue", book="wallet", units=base_units,
            registry_hash=H),
        ObservedBalance(asset_unit_id=definition.quote_asset_unit_id,
            location_id="venue", book="wallet", units="10000000000",
            registry_hash=H),
        *( (ObservedBalance(asset_unit_id="ETH:18", location_id="venue",
            book="wallet", units="10000000000000000", registry_hash=H),)
           if include_eth else ()),
        *wallet_rows,
    )
    body = dict(scope=manifest().scope, snapshot_hash="0" * 64,
        source_account_id="fixture", origin="recorded_fixture", status="accepted",
        event_at=NOW, available_at=NOW, received_at=NOW, cutoff_at=NOW,
        finality_at=NOW, finality="admitted_final", has_gap=False,
        has_reorg=False, balances_complete=True, positions_complete=True,
        rights_ref="local_simulation_fixture_only", source_event_hash=H,
        source_payload_hash=H, registry_hash=H,
        policy_version=approved.policy_version,
        observed_balances=balances, observed_positions=())
    provisional = AccountObservationSnapshotRef.model_validate(body)
    snapshot = AccountObservationSnapshotRef.model_validate(body | {
        "snapshot_hash": account_snapshot_hash(provisional)})
    run = manifest(scenario=source,
        instrument_version_ids=(definition.instrument_version_id,),
        evidence_snapshot_hash=evidence.snapshot_hash,
        account_snapshot_hash=snapshot.snapshot_hash,
        policy_hash=approved.policy_hash,
        policy_version=approved.policy_version)
    decision, selected = build_replay_decision(run, (book,), NOW, evidence,
        instrument_version_id=definition.instrument_version_id,
        account_snapshot_hash=snapshot.snapshot_hash)
    return run, decision, approved, definition, selected, evidence, (book,), snapshot


def size(inputs, *, action="spot_buy", side="buy", desired="10000000"):
    run, decision, approved, definition, book, evidence, dataset, snapshot = inputs
    return build_replay_sizing_receipt(run, decision, approved, definition,
        book, evidence, dataset, snapshot, (), (),
        request_id="request-1", action=action,
        side=side, desired_quantity_units=desired, order_ordinal=1,
        account_revision=1)


def test_spot_receipt_holds_exact_registered_third_asset_fee_without_conversion():
    result = size(case())
    assert result.valuation_scope == "instrument_only"
    assert result.quantity_units == "10000000"
    assert result.notional_units == "2500100000"
    assert {(row.asset_unit_id, row.units) for row in result.components} == {
        ("venue-a:USDC:6", "2510100000"),
        ("ETH:18", "1000000000000000")}
    assert result == size(case())


def test_missing_fee_registration_and_unvalued_wallet_deny():
    with pytest.raises(ValueError, match="fee asset lacks registered"):
        size(case(fee_asset="OTHER:18", include_eth=False))
    extra = ObservedBalance(asset_unit_id="SOL:9", location_id="venue",
        book="wallet", units="1", registry_hash=H)
    with pytest.raises(ValueError, match="unvalued"):
        size(case(wallet_rows=(extra,)))


def test_cheaper_book_outside_accepted_dataset_cannot_change_receipt():
    run, decision, approved, definition, selected, evidence, dataset, snapshot = case()
    forged = selected.model_copy(update={"asks": (
        BookLevel(price_quote_per_base="25000", size_base="1"),)})
    with pytest.raises(ValueError, match="accepted decision evidence"):
        build_replay_sizing_receipt(run, decision, approved, definition,
            forged, evidence, dataset, snapshot, (), (),
            request_id="request-1", action="spot_buy", side="buy",
            desired_quantity_units="10000000", order_ordinal=1,
            account_revision=1)


def test_spot_reduction_remains_possible_at_instrument_gross_cap():
    receipt = size(case(base_units="20000000", gross_cap="5000000000"),
                   action="spot_sell", side="sell", desired="10000000")
    assert receipt.target_exposure_units == "10000000"
    assert {(row.asset_unit_id, row.units) for row in receipt.components} == {
        ("venue-a:BTC:8", "10000000"),
        ("venue-a:USDC:6", "10000000"),
        ("ETH:18", "1000000000000000")}


def test_spot_collateral_and_ambiguous_second_location_deny():
    collateral = ObservedBalance(asset_unit_id="venue-a:USDC:6", location_id="venue",
        book="collateral", units="1", registry_hash=H)
    with pytest.raises(ValueError, match="encumbered"):
        size(case(wallet_rows=(collateral,)))
    second = (
        ObservedBalance(asset_unit_id="venue-a:BTC:8", location_id="venue-2",
            book="wallet", units="0", registry_hash=H),
        ObservedBalance(asset_unit_id="venue-a:USDC:6", location_id="venue-2",
            book="wallet", units="0", registry_hash=H))
    with pytest.raises(ValueError, match="unique registered"):
        size(case(wallet_rows=second))


def perp_case(*, open_contracts=0):
    definition = perp_definition()
    book = perp_book(25000, "buy" if not open_contracts else "sell", "perp-size")
    evidence = replay_observations((definition,), (book,), NOW, 5_000)
    approved = policy(instrument_version_id=definition.instrument_version_id,
        max_quantity_units="100", max_gross_notional_units="25000000000",
        max_directional_notional_units="25000000000",
        fee_ceiling_units="10000000", min_quantity_units="1",
        quantity_step_units="1", initial_margin_bps=2000)
    collateral = open_contracts * 50_000_000
    permit = perp_permit(definition, 1, "perp_open", "buy", 10)
    state = empty_position_state(permit, definition)
    if open_contracts:
        state = state.model_copy(update={
            "signed_quantity_units": str(open_contracts),
            "open_cost_numerator": str(open_contracts * 250_000_000),
            "margin_reserved_units": str(collateral),
            "collateral_units": str(collateral)})
    positions = (state,) if open_contracts else ()
    observed_positions = (ObservedPosition(
        instrument_version_id=definition.instrument_version_id,
        location_id="venue", instrument_registry_hash=definition.registry_hash,
        contract_size_unit_id=definition.base_asset_unit_id,
        signed_contracts=str(open_contracts),
        collateral_asset_unit_id=definition.settlement_asset_unit_id,
        margin_units=str(collateral), funding_event_ids=(), fee_event_ids=()),) \
        if open_contracts else ()
    body = dict(scope=manifest().scope, snapshot_hash="0" * 64,
        source_account_id="fixture", origin="simulation_derived", status="accepted",
        event_at=NOW, available_at=NOW, received_at=NOW, cutoff_at=NOW,
        finality_at=NOW, finality="admitted_final", has_gap=False,
        has_reorg=False, balances_complete=True, positions_complete=True,
        rights_ref="local_simulation_fixture_only", source_event_hash=H,
        source_payload_hash=H, registry_hash=H,
        policy_version=approved.policy_version,
        observed_balances=(
            ObservedBalance(asset_unit_id=definition.base_asset_unit_id,
                location_id="venue", book="wallet", units="0", registry_hash=H),
            ObservedBalance(asset_unit_id=definition.settlement_asset_unit_id,
                location_id="venue", book="wallet",
                units=str(10_000_000_000 - collateral), registry_hash=H),
            ObservedBalance(asset_unit_id=definition.settlement_asset_unit_id,
                location_id="venue", book="collateral", units=str(collateral),
                registry_hash=H)), observed_positions=observed_positions)
    provisional = AccountObservationSnapshotRef.model_validate(body)
    snapshot = AccountObservationSnapshotRef.model_validate(body | {
        "snapshot_hash": account_snapshot_hash(provisional)})
    source = scenario(model_hash=MODEL_HASH, model_version=MODEL_VERSION,
        dataset_hash=simulation_dataset_hash((book,)),
        evidence_cutoff_at=NOW, simulation_cursor_at=NOW,
        simulation_end_at=NOW + timedelta(seconds=2),
        fee_rules=(), funding_rules=(), outcome_rules=())
    run = manifest(scenario=source,
        instrument_version_ids=(definition.instrument_version_id,),
        evidence_snapshot_hash=evidence.snapshot_hash,
        account_snapshot_hash=snapshot.snapshot_hash,
        policy_hash=approved.policy_hash, policy_version=approved.policy_version)
    decision, selected = build_replay_decision(run, (book,), NOW, evidence,
        instrument_version_id=definition.instrument_version_id,
        account_snapshot_hash=snapshot.snapshot_hash)
    if positions:
        positions = (positions[0].model_copy(update={
            "run_id": run.run_id, "location_id": "venue"}),)
    return run, decision, approved, definition, selected, evidence, (book,), \
        snapshot, positions


def test_linear_perp_open_holds_margin_and_quote_fee_and_close_holds_no_new_margin():
    *inputs, positions = perp_case()
    opened = build_replay_sizing_receipt(*inputs, positions, (),
        request_id="perp-open", action="perp_open", side="buy",
        desired_quantity_units="10", order_ordinal=1, account_revision=1)
    assert opened.quantity_kind == "contracts"
    assert opened.contract_size_units == "1000000"
    assert opened.notional_units == "2500000000"
    assert opened.target_exposure_units == "10"
    assert [(row.asset_unit_id, row.units) for row in opened.components] == [
        ("venue-a:USDC:6", "510000000")]
    *inputs, positions = perp_case(open_contracts=10)
    closed = build_replay_sizing_receipt(*inputs, positions, (),
        request_id="perp-close", action="perp_close", side="sell",
        desired_quantity_units="10", order_ordinal=1, account_revision=2)
    assert closed.target_exposure_units == "0"
    assert [(row.asset_unit_id, row.units) for row in closed.components] == [
        ("venue-a:USDC:6", "10000000")]


def test_linear_perp_increase_and_reduce_keep_direction_and_margin_separate():
    *inputs, positions = perp_case(open_contracts=10)
    increased = build_replay_sizing_receipt(*inputs, positions, (),
        request_id="perp-increase", action="perp_increase", side="buy",
        desired_quantity_units="5", order_ordinal=1, account_revision=2)
    assert increased.target_exposure_units == "15"
    assert increased.notional_units == "1250050000"
    assert [(row.asset_unit_id, row.units) for row in increased.components] == [
        ("venue-a:USDC:6", "260010000")]
    reduced = build_replay_sizing_receipt(*inputs, positions, (),
        request_id="perp-reduce", action="perp_reduce", side="sell",
        desired_quantity_units="6", order_ordinal=1, account_revision=2)
    assert reduced.target_exposure_units == "4"
    assert reduced.risk_notional_units > reduced.notional_units
    assert [(row.asset_unit_id, row.units) for row in reduced.components] == [
        ("venue-a:USDC:6", "10000000")]
    with pytest.raises(ValueError, match="reduction differs"):
        build_replay_sizing_receipt(*inputs, positions, (),
            request_id="wrong-way", action="perp_reduce", side="buy",
            desired_quantity_units="6", order_ordinal=1, account_revision=2)


def test_pending_perp_opposite_direction_cannot_be_nettable_in_receipt():
    *inputs, positions = perp_case()
    first = build_replay_sizing_receipt(*inputs, positions, (),
        request_id="first-long", action="perp_open", side="buy",
        desired_quantity_units="10", order_ordinal=1, account_revision=1)
    with pytest.raises(ValueError, match="pending perpetual direction"):
        build_replay_sizing_receipt(*inputs, positions, (first,),
            request_id="opposite-short", action="perp_open", side="sell",
            desired_quantity_units="10", order_ordinal=2, account_revision=1)


def test_pending_receipt_from_another_run_cannot_be_valued_here():
    *inputs, positions = perp_case()
    first = build_replay_sizing_receipt(*inputs, positions, (),
        request_id="first-long", action="perp_open", side="buy",
        desired_quantity_units="10", order_ordinal=1, account_revision=1)
    foreign = first.model_dump(mode="json", exclude={"receipt_hash"})
    foreign["run_id"] = "another-run"
    foreign["receipt_hash"] = _digest("moeazi-replay-sizing-v1", foreign)
    valid_foreign = ReplaySizingReceipt.model_validate_json(json.dumps(foreign))
    with pytest.raises(ValueError, match="pending replay obligation cannot be valued"):
        build_replay_sizing_receipt(*inputs, positions, (valid_foreign,),
            request_id="second-long", action="perp_open", side="buy",
            desired_quantity_units="1", order_ordinal=2, account_revision=2)


@pytest.mark.asyncio
async def test_late_simulated_fill_cannot_outlive_explicit_protection_horizon():
    manifest_stub = SimpleNamespace(
        protection_policy=SimpleNamespace(maximum_unprotected_seconds=20),
        scenario=SimpleNamespace(simulation_end_at=NOW + timedelta(seconds=30)))
    permit_stub = SimpleNamespace(action="spot_buy")
    late_fill = SimpleNamespace(kind="fill",
        simulation_cursor_at=NOW + timedelta(seconds=15))
    with pytest.raises(ValueError, match="in-horizon protection deadline"):
        await preflight_replay_order(None, None, {}, None, manifest_stub,
                                     permit_stub, (late_fill,))
