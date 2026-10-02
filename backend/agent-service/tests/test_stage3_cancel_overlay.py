"""Independent replay-time cancel precedence with no native transport."""
from datetime import timedelta

import pytest

from moeazi_agent.lifecycle_cancel_receipts import control_hash, seal_cancel_dispatch
from moeazi_agent.lifecycle_replay import simulate_run
from test_stage2_observation_replay import NOW, instrument
from test_stage3_replay_protection import bound
from test_stage3_run_contracts import manifest
from test_stage3_simulator_oracle import observations, permit_for, scenario_for


def fixture(*, quantity="30000000", outcome_rules=()):
    definition = instrument()
    books = observations()
    scenario = scenario_for(books, fee_rules=(), outcome_rules=outcome_rules)
    run = manifest(scenario=scenario,
        instrument_version_ids=(definition.instrument_version_id,))
    request = bound(permit_for(definition, quantity_units=quantity), run)
    return definition, books, run, request


def receipt(run, request, requested_ms, effective_ms):
    command = f"cancel-at-{requested_ms}-{effective_ms}"
    return seal_cancel_dispatch(schemaVersion=1, scope=run.scope,
        runId=run.run_id, manifestHash=run.manifest_hash,
        commandId=command,
        commandHash=control_hash(run.scope, run.run_id, run.manifest_hash,
            command, "request_cancel", request.order_id),
        operation="request_cancel", processingKind="dispatched",
        outcome="requested", targetOrderId=request.order_id,
        permitHash=request.permit_hash,
        requestedCursor=NOW + timedelta(milliseconds=requested_ms),
        effectiveCursor=NOW + timedelta(milliseconds=effective_ms))


def replay(definition, books, run, request, dispatch):
    return simulate_run(run, (request,), (definition,), books,
                        cancel_receipts=(dispatch,))


def test_request_before_acceptance_keeps_partial_fill_and_cancels_residual():
    definition, books, run, request = fixture()
    dispatch = receipt(run, request, 0, 80)
    events = replay(definition, books, run, request, dispatch)
    assert [(row.kind, row.cumulative_filled_units) for row in events] == [
        ("cancel_requested", "0"), ("accepted", "0"),
        ("fill", "10000000"), ("cancelled", "10000000")]
    assert events == replay(definition, books, run, request, dispatch)
    assert len({row.event_hash for row in events}) == len(events)


def test_full_fill_at_effective_has_no_false_cancelled_terminal():
    definition, books, run, request = fixture(quantity="10000000")
    events = replay(definition, books, run, request,
                    receipt(run, request, 0, 25))
    assert [row.kind for row in events] == [
        "cancel_requested", "accepted", "fill"]
    assert events[-1].cumulative_filled_units == request.quantity_units


def test_same_cursor_fill_is_retained_before_cancelled_residual():
    definition, books, run, request = fixture()
    events = replay(definition, books, run, request,
                    receipt(run, request, 30, 100))
    at_effective = [row for row in events
        if row.simulation_cursor_at == NOW + timedelta(milliseconds=100)]
    assert [(row.kind, row.cumulative_filled_units)
            for row in at_effective] == [("fill", "20000000"),
                                        ("cancelled", "20000000")]


@pytest.mark.parametrize("terminal_ms,expect", [
    (75, "static"), (120, "dynamic"),
])
def test_static_terminal_during_latency_wins_later_terminal_is_superseded(
        terminal_ms, expect):
    rule = ({"order_ordinal": 1,
        "source_event_id": f"static-reject-{terminal_ms}",
        "kind": "rejected",
        "at_cursor": NOW + timedelta(milliseconds=terminal_ms)},)
    definition, books, run, request = fixture(outcome_rules=rule)
    events = replay(definition, books, run, request,
                    receipt(run, request, 30, 80))
    terminal = [row for row in events if row.kind in {"cancelled", "rejected"}]
    assert len(terminal) == 1
    if expect == "dynamic":
        assert terminal[0].kind == "cancelled"
        assert terminal[0].source_stream == "moeazi_simulation_control_v1"
    else:
        assert terminal[0].kind == "rejected"
        assert terminal[0].source_event_id == f"static-reject-{terminal_ms}"
    assert terminal[0].simulation_cursor_at == NOW + timedelta(
        milliseconds=80 if expect == "dynamic" else terminal_ms)


def test_terminal_before_cancel_request_rejects_dispatch():
    rule = ({"order_ordinal": 1, "source_event_id": "early-reject",
        "kind": "rejected", "at_cursor": NOW + timedelta(milliseconds=27)},)
    definition, books, run, request = fixture(outcome_rules=rule)
    with pytest.raises(ValueError, match="conflicts|terminal"):
        replay(definition, books, run, request, receipt(run, request, 30, 80))
