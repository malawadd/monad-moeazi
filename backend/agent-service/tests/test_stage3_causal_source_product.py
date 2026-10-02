"""Causal source facts follow later books without changing dispatch admission."""
from datetime import timedelta

import pytest

from moeazi_agent.lifecycle_cancel_receipts import control_hash, seal_cancel_dispatch
from moeazi_agent.lifecycle_order_replay_preflight import preflight_replay_order
from moeazi_agent.lifecycle_replay import simulate_run
from test_stage3_causal_envelope_product import _case
from test_stage3_lifecycle_contracts import permit


def _run(future_ask: str, **options):
    run, instrument, dataset, decision, receipt = _case(future_ask, **options)
    order = _permit(run, instrument, decision, receipt)
    return simulate_run(run, (order,), (instrument,), dataset,
                        {order.order_id: decision})


def _permit(run, instrument, decision, receipt, **overrides):
    envelope = receipt.execution_envelope
    return permit(scope=run.scope, controller_ref=run.controller_ref,
        controller_mode=run.controller_mode, run_id=run.run_id,
        run_manifest_hash=run.manifest_hash, policy_hash=run.policy_hash,
        instrument_version_id=instrument.instrument_version_id,
        instrument_registry_hash=instrument.registry_hash,
        action=receipt.action, side=receipt.side,
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
        execution_envelope=envelope, **overrides)


def test_future_adverse_book_does_not_retroactively_reject_causal_order():
    favorable = _run("22000")
    adverse = _run("35000")
    assert favorable[0].kind == adverse[0].kind == "accepted"
    assert favorable[0].simulation_cursor_at == adverse[0].simulation_cursor_at
    assert [(row.kind, row.fill_quantity_units, row.simulation_cursor_at)
            for row in favorable[:2]] == [
            (row.kind, row.fill_quantity_units, row.simulation_cursor_at)
            for row in adverse[:2]]
    assert [row.kind for row in favorable] == [
        "accepted", "fill", "fill", "cancelled"]
    assert [row.kind for row in adverse] == ["accepted", "fill", "cancelled"]
    assert adverse[-1].kind == "cancelled"
    assert adverse[-1].terminal_reason == "residual_time_in_force"


def test_cancelled_order_cannot_spend_later_depth_needed_by_peer():
    run, instrument, dataset, decision, receipt = _case("22000")
    first = _permit(run, instrument, decision, receipt)
    second = _permit(run, instrument, decision, receipt,
        order_id="order-b", order_ordinal=2, client_id="client-b",
        attempt_id="attempt-b")
    command = "cancel-first-before-new-book"
    dispatch = seal_cancel_dispatch(schemaVersion=1, scope=run.scope,
        runId=run.run_id, manifestHash=run.manifest_hash,
        commandId=command, commandHash=control_hash(run.scope,
            run.run_id, run.manifest_hash, command, "request_cancel",
            first.order_id), operation="request_cancel",
        processingKind="dispatched", outcome="requested",
        targetOrderId=first.order_id, permitHash=first.permit_hash,
        requestedCursor=decision.cursor_at + timedelta(milliseconds=100),
        effectiveCursor=decision.cursor_at + timedelta(milliseconds=200))
    events = simulate_run(run, (first, second), (instrument,), dataset,
        {first.order_id: decision, second.order_id: decision}, (dispatch,))
    later = [row for row in events if row.kind == "fill" and
        row.simulation_cursor_at == decision.cursor_at + timedelta(milliseconds=300)]
    assert len(later) == 1
    assert later[0].order_id == second.order_id


def test_improved_sell_price_cannot_spend_unheld_quote_fee():
    events = _run("5500000", action="spot_sell", side="sell",
                  base_units="10000000")
    assert [row.kind for row in events] == ["accepted", "fill", "cancelled"]
    assert events[-1].terminal_reason == "envelope_exhausted"
    assert events[1].fill_quantity_units == "250000"


@pytest.mark.asyncio
async def test_causal_spot_dispatch_uses_held_static_envelope_only():
    run, instrument, _, decision, receipt = _case("35000")
    order = _permit(run, instrument, decision, receipt)
    await preflight_replay_order(None, None, {}, receipt, run, order, ())
