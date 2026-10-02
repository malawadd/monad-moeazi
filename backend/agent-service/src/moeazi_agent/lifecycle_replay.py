"""Pure run replay coordinator; SQL remains the only financial authority."""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from fractions import Fraction

from .finance_contracts import FinanceError, native_int
from .lifecycle_contracts import ExecutionEvent, ExecutionPermit
from .lifecycle_decision import ReplayDecisionContext
from .lifecycle_cancel_receipts import CancelDispatchReceipt
from .lifecycle_cancel_source import overlay_cancel_events
from .lifecycle_run_contracts import SimulationRunManifest, simulation_dataset_hash
from .lifecycle_simulator import simulate_order
from .lifecycle_execution_envelope import CAUSAL_MODEL_VERSION
from .lifecycle_position_math_contracts import PositionArithmeticState
from .observation_contracts import InstrumentVersion, MarketObservation, canonical_hash


def _check_depth(events: tuple[ExecutionEvent, ...],
                 instruments: dict[str, InstrumentVersion],
                 observations: tuple[MarketObservation, ...],
                 participation_bps: int) -> None:
    """Do not sell the same visible level twice across orders in one run."""
    books = {canonical_hash(item.model_dump(mode="json")): item for item in observations}
    used: dict[tuple[str, str, Fraction], int] = defaultdict(int)
    for event in events:
        if event.kind != "fill":
            continue
        book = books.get(event.observation_hash or "")
        instrument = instruments[event.instrument_version_id]
        if book is None or event.price_numerator is None or \
                event.price_denominator is None:
            raise FinanceError("run fill lacks frozen market evidence")
        native_price = Fraction(native_int(event.price_numerator, positive=True),
                                native_int(event.price_denominator, positive=True))
        level_price = native_price * 10 ** instrument.base_decimals / \
            10 ** instrument.quote_decimals
        matching = tuple(("buy", level) for level in book.asks
                         if Fraction(level.price_quote_per_base) == level_price) + \
                   tuple(("sell", level) for level in book.bids
                         if Fraction(level.price_quote_per_base) == level_price)
        if len(matching) != 1:
            raise FinanceError("run fill price does not identify one visible level")
        side, level = matching[0]
        base_units = native_int(event.fill_quantity_units or "0", positive=True) * \
            (native_int(event.contract_size_units, positive=True)
             if event.quantity_kind == "contracts" and event.contract_size_units else 1)
        key = (event.observation_hash or "", side, native_price)
        used[key] += base_units
        visible = Fraction(level.size_base) * 10 ** instrument.base_decimals
        permitted = visible * participation_bps / 10_000
        if used[key] > permitted:
            raise FinanceError("orders overconsume one frozen book level")


def _check_funding_exposure(events: tuple[ExecutionEvent, ...],
                            permits: tuple[ExecutionPermit, ...],
                            instruments: dict[str, InstrumentVersion]) -> None:
    """Payment facts require aggregate open linear exposure at their replay time."""
    by_order = {permit.order_id: permit for permit in permits}
    exposure: dict[tuple[str, str], int] = defaultdict(int)
    for event in events:
        permit = by_order[event.order_id]
        instrument = instruments[event.instrument_version_id]
        key = event.instrument_version_id, permit.location_id
        if event.kind == "fill" and instrument.product_kind == "perpetual":
            quantity = native_int(event.fill_quantity_units or "0", positive=True)
            signed = quantity if permit.side == "buy" else -quantity
            before = exposure[key]
            if permit.action in {"perp_open", "perp_increase"}:
                if before and (before > 0) != (signed > 0):
                    raise FinanceError("opening fill reverses an existing perpetual")
            elif permit.action in {"perp_reduce", "perp_close"}:
                if before == 0 or (before > 0) == (signed > 0) or \
                        quantity > abs(before):
                    raise FinanceError("reducing fill exceeds aggregate perpetual exposure")
            else:
                raise FinanceError("perpetual fill has unsupported action")
            exposure[key] += signed
        if event.kind == "funding" and (
                instrument.product_kind != "perpetual" or
                instrument.margin_model != "linear_v1" or
                event.quantity_kind != "contracts" or
                event.funding_asset_unit_id != instrument.settlement_asset_unit_id or
                exposure[key] == 0):
            raise FinanceError("funding payment lacks open linear exposure at replay time")


def simulate_run(manifest: SimulationRunManifest,
                 permits: tuple[ExecutionPermit, ...],
                 instruments: tuple[InstrumentVersion, ...],
                 accepted_observations: tuple[MarketObservation, ...],
                 decision_contexts: Mapping[str, ReplayDecisionContext] | None = None,
                 cancel_receipts: tuple[CancelDispatchReceipt, ...] = (),
                 *, position_anchors: Mapping[str, PositionArithmeticState] | None = None,
                 margin_bps: int | None = None,
                 ) -> tuple[ExecutionEvent, ...]:
    """Replay frozen per-order facts and reject cross-order source/depth conflicts."""
    scenario = manifest.scenario
    if simulation_dataset_hash(accepted_observations) != scenario.dataset_hash:
        raise FinanceError("run dataset differs from frozen manifest")
    registry = {item.instrument_version_id: item for item in instruments}
    if len(registry) != len(instruments) or \
            set(registry) != set(manifest.instrument_version_ids):
        raise FinanceError("run instrument versions differ from frozen manifest")
    if len({item.order_id for item in permits}) != len(permits) or \
            len({item.client_id for item in permits}) != len(permits) or \
            len({item.attempt_id for item in permits}) != len(permits) or \
            len({item.order_ordinal for item in permits}) != len(permits):
        raise FinanceError("run repeats an economic order identity")
    contexts = decision_contexts or {}
    if set(contexts) - {item.order_id for item in permits}:
        raise FinanceError("replay decision context has no persisted permit")
    if scenario.model_version == CAUSAL_MODEL_VERSION:
        from .lifecycle_simulator_causal import simulate_run_causal

        return simulate_run_causal(manifest, permits, instruments,
            accepted_observations, dict(contexts), cancel_receipts,
            dict(position_anchors or {}), margin_bps)
    events: list[ExecutionEvent] = []
    for permit in sorted(permits, key=lambda item: item.order_ordinal):
        if permit.scope != manifest.scope or permit.controller_ref != manifest.controller_ref or \
                permit.controller_mode != manifest.controller_mode or \
                permit.run_id != manifest.run_id or \
                permit.run_manifest_hash != manifest.manifest_hash or \
                permit.policy_hash != manifest.policy_hash or \
                permit.instrument_version_id not in registry:
            raise FinanceError("permit differs from immutable run identity")
        context = contexts.get(permit.order_id)
        if context is None and (permit.evidence_snapshot_hash !=
                                manifest.evidence_snapshot_hash or
                                permit.issued_at_cursor != scenario.simulation_cursor_at):
            raise FinanceError("later permit lacks a persisted replay decision")
        events.extend(simulate_order(permit, registry[permit.instrument_version_id],
                                     accepted_observations, scenario, context))
    if len({item.source_event_id for item in events}) != len(events):
        raise FinanceError("run repeats an immutable source event identity")
    static = tuple(sorted(events, key=lambda item: (item.simulation_cursor_at,
        item.order_ordinal, item.sequence, item.source_event_id)))
    result = overlay_cancel_events(manifest, permits, static, cancel_receipts)
    _check_depth(result, registry, accepted_observations,
                 scenario.depth_participation_bps)
    _check_funding_exposure(result, permits, registry)
    return result
