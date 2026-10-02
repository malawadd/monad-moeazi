"""Overlay immutable replay-time cancel dispatches on frozen scenario facts."""
from __future__ import annotations

from collections import defaultdict

from .finance_contracts import FinanceError, _digest, native_int
from .lifecycle_cancel_receipts import CancelDispatchReceipt
from .lifecycle_contracts import ExecutionEvent, ExecutionPermit
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_simulator import _source_event

CONTROL_STREAM = "moeazi_simulation_control_v1"
REQUEST_SEQUENCE = 1_000_000_000
TERMINAL_SEQUENCE = REQUEST_SEQUENCE + 1


def overlay_cancel_events(manifest: SimulationRunManifest,
                          permits: tuple[ExecutionPermit, ...],
                          static_events: tuple[ExecutionEvent, ...],
                          receipts: tuple[CancelDispatchReceipt, ...]
                          ) -> tuple[ExecutionEvent, ...]:
    """Keep the old prefix and fills through effective time; cancel residual only."""
    if not receipts:
        return static_events
    by_order = {permit.order_id: permit for permit in permits}
    if len(by_order) != len(permits) or len({row.targetOrderId for row in receipts}) \
            != len(receipts):
        raise FinanceError("cancellation source repeats an order identity")
    grouped: dict[str, list[ExecutionEvent]] = defaultdict(list)
    for event in static_events:
        grouped[event.order_id].append(event)
    retained = list(static_events)
    dynamic: list[ExecutionEvent] = []
    for receipt in receipts:
        permit = by_order.get(receipt.targetOrderId)
        if permit is None or receipt.scope != manifest.scope or \
                receipt.runId != manifest.run_id or \
                receipt.manifestHash != manifest.manifest_hash or \
                receipt.permitHash != permit.permit_hash or \
                not manifest.scenario.simulation_cursor_at <= receipt.requestedCursor <= \
                manifest.scenario.simulation_end_at or \
                receipt.effectiveCursor < receipt.requestedCursor:
            raise FinanceError("cancellation receipt differs from frozen order")
        prior = grouped.get(permit.order_id, ())
        accepted = next((row for row in prior if row.kind == "accepted"), None)
        if accepted is None or receipt.effectiveCursor < accepted.simulation_cursor_at or \
                any(row.kind in {"cancel_requested", "cancelled", "rejected"} and
                    row.simulation_cursor_at <= receipt.requestedCursor for row in prior):
            raise FinanceError("cancellation dispatch conflicts with prior source outcome")
        terminal_during = any(row.kind in {"cancelled", "rejected"} and
            receipt.requestedCursor < row.simulation_cursor_at <= receipt.effectiveCursor
            for row in prior)
        before_request = max((native_int(row.cumulative_filled_units)
            for row in prior if row.kind == "fill" and
            row.simulation_cursor_at <= receipt.requestedCursor), default=0)
        through_effective = max((native_int(row.cumulative_filled_units)
            for row in prior if row.kind == "fill" and
            row.simulation_cursor_at <= receipt.effectiveCursor), default=0)
        quantity = native_int(permit.quantity_units, positive=True)
        if before_request >= quantity:
            raise FinanceError("fully filled order cannot dispatch a new cancellation")
        if terminal_during and through_effective >= quantity:
            raise FinanceError("static terminal conflicts with a complete prior fill")
        source_id = lambda kind: _digest("moeazi-sim-control-source-id-v1", {
            "dispatchHash": receipt.resultHash, "kind": kind})
        dynamic.append(_source_event(permit, manifest.scenario, REQUEST_SEQUENCE,
            "cancel_requested", receipt.requestedCursor, before_request,
            source_stream=CONTROL_STREAM, source_event_id=source_id("cancel_requested")))
        if not terminal_during and \
                receipt.effectiveCursor <= manifest.scenario.simulation_end_at and \
                through_effective < quantity:
            dynamic.append(_source_event(permit, manifest.scenario, TERMINAL_SEQUENCE,
                "cancelled", receipt.effectiveCursor, through_effective,
                source_stream=CONTROL_STREAM, source_event_id=source_id("cancelled")))
        # The receipt supersedes only future order response/fill facts. Funding
        # for an already open position is independent account exposure.
        retained = [row for row in retained if row.order_id != permit.order_id or
                    (row.simulation_cursor_at <= receipt.effectiveCursor and
                     not (row.kind == "cancel_requested" and
                          row.simulation_cursor_at > receipt.requestedCursor)) or
                    row.kind == "funding"]
    merged = (*retained, *dynamic)
    if len({row.source_event_id for row in merged}) != len(merged):
        raise FinanceError("control replay collides with frozen source identity")
    return tuple(sorted(merged, key=lambda row: (row.simulation_cursor_at,
        row.order_ordinal, row.sequence, row.source_event_id)))
