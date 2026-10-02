"""Independent causal replay oracles for admission and shared visible depth."""
from datetime import timedelta
from fractions import Fraction

from moeazi_agent.lifecycle_decision import build_replay_decision
from moeazi_agent.lifecycle_cancel_receipts import control_hash, seal_cancel_dispatch
from moeazi_agent.lifecycle_replay import simulate_run
from moeazi_agent.lifecycle_replay_sizing import build_replay_sizing_receipt
from moeazi_agent.lifecycle_run_contracts import simulation_dataset_hash
from moeazi_agent.lifecycle_execution_envelope import CAUSAL_MODEL_VERSION
from moeazi_agent.lifecycle_simulator import CAUSAL_MODEL_HASH
from moeazi_agent.lifecycle_simulator_causal_inputs import native_ratio
from moeazi_agent.observation_contracts import BookLevel
from test_stage2_observation_replay import NOW
from test_stage3_causal_envelope_product import _case, _policy
from test_stage3_lifecycle_contracts import permit
from test_stage3_replay_sizing_product import case
from test_stage3_run_contracts import manifest, scenario
from test_stage3_strategy_signal_boundary import admitted


def _order(run, instrument, decision, receipt, ordinal):
    return permit(scope=run.scope, controller_ref=run.controller_ref,
        controller_mode=run.controller_mode, run_id=run.run_id,
        run_manifest_hash=run.manifest_hash, policy_hash=run.policy_hash,
        instrument_version_id=instrument.instrument_version_id,
        instrument_registry_hash=instrument.registry_hash,
        quantity_asset_unit_id=instrument.base_asset_unit_id,
        quantity_registry_hash=receipt.base_registry_hash,
        quote_asset_unit_id=instrument.quote_asset_unit_id,
        quote_registry_hash=receipt.quote_registry_hash,
        settlement_asset_unit_id=instrument.settlement_asset_unit_id,
        settlement_registry_hash=receipt.settlement_registry_hash,
        quantity_units=receipt.quantity_units, location_id=receipt.location_id,
        evidence_snapshot_hash=decision.evidence_snapshot_hash,
        decision_context_hash=decision.decision_hash,
        issued_at_cursor=decision.cursor_at,
        valid_until_cursor=decision.cursor_at + timedelta(milliseconds=50),
        execution_envelope=receipt.execution_envelope,
        action=receipt.action, side=receipt.side,
        order_ordinal=ordinal, order_id=f"shared-book-order-{ordinal}",
        intent_id=f"shared-book-intent-{ordinal}",
        client_id=f"shared-book-client-{ordinal}",
        attempt_id=f"shared-book-attempt-{ordinal}",
        reservation_id=f"shared-book-reservation-{ordinal}")


def test_two_orders_share_one_visible_book_level_without_refill():
    run, instrument, dataset, decision, receipt = _case("35000")
    first = _order(run, instrument, decision, receipt, 1)
    second = _order(run, instrument, decision, receipt, 2)
    events = simulate_run(run, (first, second), (instrument,), dataset,
                          {first.order_id: decision, second.order_id: decision})
    accepted = [row for row in events if row.kind == "accepted"]
    fills = [row for row in events if row.kind == "fill"]
    assert len(accepted) == 2
    assert fills and {row.order_id for row in fills} == {first.order_id}
    assert all(row.observation_hash == receipt.execution_envelope.selected_observation_hash
               for row in fills)
    level = dataset[0].asks[0]
    visible = Fraction(level.size_base) * 10 ** instrument.base_decimals * \
        run.scenario.depth_participation_bps / 10_000
    assert sum(int(row.fill_quantity_units) for row in fills) <= visible
    assert all(native_ratio(level.price_quote_per_base, instrument) <=
               Fraction(int(first.execution_envelope.limit_price_numerator),
                        int(first.execution_envelope.limit_price_denominator))
               for _ in fills)


def test_divergent_future_books_do_not_censor_current_acceptance_or_first_fill():
    traces = []
    for future_ask in ("22000", "35000"):
        run, instrument, dataset, decision, receipt = _case(future_ask)
        order = _order(run, instrument, decision, receipt, 1)
        events = simulate_run(run, (order,), (instrument,), dataset,
                              {order.order_id: decision})
        current = [row for row in events if row.kind in {"accepted", "fill"}
                   and row.simulation_cursor_at < dataset[1].available_at]
        assert [row.kind for row in current] == ["accepted", "fill"]
        traces.append(tuple((row.kind, row.simulation_cursor_at,
                             row.fill_quantity_units, row.price_numerator,
                             row.price_denominator, row.fee_units) for row in current))
    assert traces[0] == traces[1]


def test_effective_cancel_does_not_refill_same_book_for_later_order():
    run, instrument, dataset, first_decision, first_receipt = _case("35000")
    first = _order(run, instrument, first_decision, first_receipt, 1)
    _, _, policy, _, _, evidence, _, snapshot = case(include_eth=False)
    later_cursor = NOW + timedelta(milliseconds=100)
    second_decision, selected = build_replay_decision(run, dataset,
        later_cursor, evidence,
        instrument_version_id=instrument.instrument_version_id,
        account_snapshot_hash=snapshot.snapshot_hash)
    second_receipt = build_replay_sizing_receipt(run, second_decision, policy,
        instrument, selected, evidence, dataset, snapshot, (), (),
        request_id="after-cancel", action="spot_buy", side="buy",
        desired_quantity_units="10000000", order_ordinal=2,
        account_revision=1)
    second = _order(run, instrument, second_decision, second_receipt, 2)
    command = "cancel-before-second-acceptance"
    cancel = seal_cancel_dispatch(schemaVersion=1, scope=run.scope,
        runId=run.run_id, manifestHash=run.manifest_hash,
        commandId=command,
        commandHash=control_hash(run.scope, run.run_id, run.manifest_hash,
            command, "request_cancel", first.order_id),
        operation="request_cancel", processingKind="dispatched",
        outcome="requested", targetOrderId=first.order_id,
        permitHash=first.permit_hash,
        requestedCursor=NOW + timedelta(milliseconds=40),
        effectiveCursor=NOW + timedelta(milliseconds=80))
    events = simulate_run(run, (first, second), (instrument,), dataset,
        {first.order_id: first_decision, second.order_id: second_decision},
        cancel_receipts=(cancel,))
    assert any(row.kind == "cancelled" and row.order_id == first.order_id and
               row.simulation_cursor_at == cancel.effectiveCursor for row in events)
    assert any(row.kind == "accepted" and row.order_id == second.order_id and
               row.simulation_cursor_at > cancel.effectiveCursor for row in events)
    assert [row.order_id for row in events if row.kind == "fill"] == [first.order_id]


def test_favorable_later_sell_price_cannot_exceed_known_fee_hold():
    old, _, policy, instrument, known, evidence, _, snapshot = case(
        base_units="20000000", include_eth=False)
    future = admitted(event_id="rising-sell-fee",
        event_at=NOW + timedelta(milliseconds=300),
        available_at=NOW + timedelta(milliseconds=300),
        received_at=NOW + timedelta(milliseconds=300),
        bids=(BookLevel(price_quote_per_base="3000000", size_base="0.02"),),
        asks=(BookLevel(price_quote_per_base="3000001", size_base="0.02"),))
    dataset = (known, future)
    frozen = scenario(model_version=CAUSAL_MODEL_VERSION,
        model_hash=CAUSAL_MODEL_HASH, dataset_hash=simulation_dataset_hash(dataset),
        simulation_cursor_at=NOW, simulation_end_at=NOW + timedelta(seconds=2),
        evidence_cutoff_at=NOW, fee_rules=(), funding_rules=(), outcome_rules=(),
        max_execution_deviation_bps=500, order_time_in_force_ms=500,
        max_fill_events_per_order=4)
    run = manifest(scope=old.scope, controller_ref=old.controller_ref,
        scenario=frozen, instrument_version_ids=(instrument.instrument_version_id,),
        evidence_snapshot_hash=evidence.snapshot_hash,
        account_snapshot_hash=snapshot.snapshot_hash,
        policy_hash=policy.policy_hash, policy_version=policy.policy_version,
        protection_policy=_policy())
    decision, selected = build_replay_decision(run, dataset, NOW, evidence,
        instrument_version_id=instrument.instrument_version_id,
        account_snapshot_hash=snapshot.snapshot_hash)
    receipt = build_replay_sizing_receipt(run, decision, policy, instrument,
        selected, evidence, dataset, snapshot, (), (), request_id="rising-sell",
        action="spot_sell", side="sell", desired_quantity_units="10000000",
        order_ordinal=1, account_revision=1)
    order = _order(run, instrument, decision, receipt, 1)
    events = simulate_run(run, (order,), (instrument,), dataset,
                          {order.order_id: decision})
    assert events[0].kind == "accepted"
    fills = [event for event in events if event.kind == "fill"]
    assert len(fills) == 1
    assert fills[0].observation_hash == receipt.execution_envelope.selected_observation_hash
    fee_limit = next(row for row in receipt.execution_envelope.liabilities
        if row.asset_unit_id == instrument.quote_asset_unit_id)
    assert sum(int(row.fee_units) for row in fills) <= int(fee_limit.max_fee_units)
    assert events[-1].kind == "cancelled"
    assert events[-1].terminal_reason == "envelope_exhausted"
