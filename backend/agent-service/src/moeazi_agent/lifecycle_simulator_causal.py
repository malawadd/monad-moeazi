"""Causal limit-order replay with shared visible depth and explicit TIF facts."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from fractions import Fraction

from .finance_contracts import FinanceError, native_int
from .lifecycle_cancel_receipts import CancelDispatchReceipt
from .lifecycle_cancel_source import overlay_cancel_events
from .lifecycle_contracts import ExecutionEvent, ExecutionPermit
from .lifecycle_decision import ReplayDecisionContext
from .lifecycle_execution_envelope import ExecutionEnvelopeV1
from .lifecycle_run_contracts import SimulationRunManifest, simulation_dataset_hash
from .lifecycle_simulator import _source_event
from .lifecycle_simulator_causal_inputs import (
    native_ratio, validate_causal_corpus, validate_causal_permit,
)
from .lifecycle_simulator_causal_position import (
    CausalPositionTracker, wallet_debits,
)
from .lifecycle_position_math_contracts import PositionArithmeticState
from .observation_contracts import InstrumentVersion, MarketObservation, canonical_hash


def _floor(value: Fraction) -> int:
    return value.numerator // value.denominator


def _ceil(value: Fraction) -> int:
    return -(-value.numerator // value.denominator)


@dataclass
class _Order:
    permit: ExecutionPermit
    instrument: InstrumentVersion
    envelope: ExecutionEnvelopeV1
    remaining: int
    source_stream: str
    events: list[ExecutionEvent] = field(default_factory=list)
    filled: int = 0
    fill_count: int = 0
    saw_adverse_price: bool = False
    exhausted: bool = False
    rejected: bool = False
    wallet_spent: dict[tuple[str, str, str], int] = field(default_factory=dict)
    fee_spent: dict[tuple[str, str, str], int] = field(default_factory=dict)
    collateral_loss_spent: int = 0

    def emit(self, scenario, kind: str, when: datetime, **extra) -> None:
        self.events.append(_source_event(self.permit, scenario, len(self.events),
            kind, when, self.filled, source_stream=self.source_stream, **extra))


def _fill_book(order: _Order, row: MarketObservation, when: datetime,
               manifest: SimulationRunManifest,
               consumed: dict[tuple[str, str, Fraction], int],
               positions: CausalPositionTracker) -> None:
    scenario = manifest.scenario
    if order.rejected or order.remaining == 0 or order.exhausted or \
            order.envelope.accepted_at_cursor > when or \
            when >= order.envelope.time_in_force_cursor or \
            (when - row.event_at).total_seconds() * 1000 > scenario.max_book_age_ms:
        return
    instrument = order.instrument
    permit = order.permit
    side = permit.side
    levels = row.asks if side == "buy" else row.bids
    observation_hash = canonical_hash(row.model_dump(mode="json"))
    contract = native_int(permit.contract_size_units, positive=True) \
        if permit.quantity_kind == "contracts" else 1
    lot = Fraction(instrument.lot_step) * 10 ** instrument.base_decimals
    if lot.denominator != 1 or contract % lot.numerator and \
            permit.quantity_kind == "contracts":
        raise FinanceError("causal lot cannot express an exact contract")
    limit = Fraction(native_int(order.envelope.limit_price_numerator, positive=True),
                     native_int(order.envelope.limit_price_denominator, positive=True))
    for level in levels:
        price = native_ratio(level.price_quote_per_base, instrument)
        if side == "buy" and price > limit or side == "sell" and price < limit:
            order.saw_adverse_price = True
            break
        depth_key = observation_hash, side, price
        visible = _floor(Fraction(level.size_base) *
            10 ** instrument.base_decimals * scenario.depth_participation_bps / 10_000)
        available = max(0, visible - consumed.get(depth_key, 0))
        quantity = min(order.remaining, available // contract)
        if permit.quantity_kind == "asset_native":
            quantity = quantity // lot.numerator * lot.numerator
        if quantity <= 0:
            continue
        if order.fill_count >= order.envelope.max_fill_events:
            order.exhausted = True
            break
        ordinal = order.fill_count + 1
        notional = Fraction(quantity * contract) * price
        fee_rule = next((rule for rule in scenario.fee_rules if
            (rule.order_ordinal, rule.fill_ordinal) ==
            (permit.order_ordinal, ordinal)), None)
        fee = ((fee_rule.asset_unit_id, fee_rule.registry_hash, fee_rule.units)
               if fee_rule else (permit.quote_asset_unit_id,
               permit.quote_registry_hash,
               str(_ceil(notional * scenario.fee_bps / 10_000))))
        fee_key = fee[0], fee[1], permit.location_id
        fee_units = native_int(fee[2], nonnegative=True)
        debits: dict[tuple[str, str, str], int] = {}
        if permit.action == "spot_buy":
            key = permit.quote_asset_unit_id, permit.quote_registry_hash, permit.location_id
            debits[key] = _ceil(notional)
        elif permit.action == "spot_sell":
            key = permit.quantity_asset_unit_id, permit.quantity_registry_hash, permit.location_id
            debits[key] = quantity
        debits[fee_key] = debits.get(fee_key, 0) + fee_units
        effect = None
        collateral_loss = 0
        if permit.quantity_kind == "contracts":
            candidate = _source_event(permit, scenario, len(order.events),
                "fill", when, order.filled + quantity,
                source_stream=order.source_stream, observation=row,
                fill=quantity, price=price, fee=fee)
            try:
                effect, collateral_loss = positions.candidate(
                    permit, instrument, candidate)
            except FinanceError as exc:
                if str(exc) != "perpetual loss exceeds available collateral":
                    raise
                order.exhausted = True
                break
            for key, amount in wallet_debits(effect).items():
                debits[key] = max(debits.get(key, 0), amount)
        limits = {(item.asset_unit_id, item.registry_hash, item.location_id): item
                  for item in order.envelope.liabilities}
        if fee_key not in limits or any(key not in limits for key in debits) or \
                (permit.quantity_kind == "contracts" and
                 order.collateral_loss_spent + collateral_loss > native_int(
                     order.envelope.max_collateral_loss_units or "0",
                     nonnegative=True)) or \
                order.fee_spent.get(fee_key, 0) + fee_units > native_int(
                    limits[fee_key].max_fee_units, nonnegative=True) or any(
                order.wallet_spent.get(key, 0) + amount > native_int(
                    limits[key].max_wallet_debit_units, positive=True)
                for key, amount in debits.items()):
            order.exhausted = True
            break
        order.fee_spent[fee_key] = order.fee_spent.get(fee_key, 0) + fee_units
        for key, amount in debits.items():
            order.wallet_spent[key] = order.wallet_spent.get(key, 0) + amount
        order.filled += quantity
        order.remaining -= quantity
        order.fill_count += 1
        order.collateral_loss_spent += collateral_loss
        if effect is not None:
            positions.commit(permit, effect)
        consumed[depth_key] = consumed.get(depth_key, 0) + quantity * contract
        order.events.append(candidate if effect is not None else _source_event(
            permit, scenario, len(order.events), "fill", when, order.filled,
            source_stream=order.source_stream, observation=row,
            fill=quantity, price=price, fee=fee))
        if not order.remaining:
            break


def simulate_run_causal(manifest: SimulationRunManifest,
        permits: tuple[ExecutionPermit, ...],
        instruments: tuple[InstrumentVersion, ...],
        observations: tuple[MarketObservation, ...],
        contexts: dict[str, ReplayDecisionContext],
        cancel_receipts: tuple[CancelDispatchReceipt, ...],
        position_anchors: dict[str, PositionArithmeticState] | None = None,
        margin_bps: int | None = None,
        ) -> tuple[ExecutionEvent, ...]:
    """An accepted order is independent of prices in later observations."""
    if simulation_dataset_hash(observations) != manifest.scenario.dataset_hash:
        raise FinanceError("causal corpus differs from frozen run dataset")
    registry = {item.instrument_version_id: item for item in instruments}
    if len(registry) != len(instruments) or \
            len({item.order_id for item in permits}) != len(permits) or \
            len({item.order_ordinal for item in permits}) != len(permits):
        raise FinanceError("causal run repeats instrument or order identity")
    validate_causal_corpus(manifest, registry, observations)
    if set(contexts) != {item.order_id for item in permits}:
        raise FinanceError("causal order lacks one exact persisted decision")
    reductions = {item.order_id for item in permits if item.action in
                  {"perp_reduce", "perp_close"}}
    if set(position_anchors or {}) != reductions or \
            (any(item.quantity_kind == "contracts" for item in permits) and
             (type(margin_bps) is not int or not 1 <= margin_bps <= 10_000)):
        raise FinanceError("causal linear replay lacks exact anchors or margin")
    source_stream = ("moeazi_simulation_causal_synthetic_v2" if
        any(item.source_kind == "synthetic_fault" for item in observations)
        else "moeazi_simulation_causal_v2")
    orders: list[_Order] = []
    positions = CausalPositionTracker(position_anchors or {}, margin_bps)
    cancel_at = {item.targetOrderId: item.effectiveCursor
                 for item in cancel_receipts}
    for permit in sorted(permits, key=lambda item: item.order_ordinal):
        instrument = registry.get(permit.instrument_version_id)
        if instrument is None:
            raise FinanceError("causal permit instrument is not in frozen run")
        envelope = validate_causal_permit(manifest, permit, instrument,
            observations, contexts[permit.order_id])
        if permit.protection_order_id is not None and \
                manifest.scenario.protection_outcome_model == "scenario_events":
            raise FinanceError("causal protective scenario outcomes are unsupported")
        orders.append(_Order(permit=permit, instrument=instrument,
            envelope=envelope, remaining=native_int(permit.quantity_units,
            positive=True), source_stream=source_stream))
    accepted: dict[datetime, list[_Order]] = {}
    expiry: dict[datetime, list[_Order]] = {}
    books: dict[datetime, list[MarketObservation]] = {}
    for order in orders:
        accepted.setdefault(order.envelope.accepted_at_cursor, []).append(order)
        expiry.setdefault(order.envelope.time_in_force_cursor, []).append(order)
    for row in observations:
        books.setdefault(row.available_at, []).append(row)
    consumed: dict[tuple[str, str, Fraction], int] = {}
    ordered_books = tuple(sorted(observations, key=lambda row:
        (row.available_at, row.source_id, row.source_event_id,
         row.raw_payload_hash)))
    for when in sorted(set(accepted) | set(expiry) | set(books)):
        new = accepted.get(when, ())
        for order in sorted(new, key=lambda item: item.permit.order_ordinal):
            order.emit(manifest.scenario, "accepted", when)
            if order.permit.protection_order_id is not None:
                confirmed = manifest.scenario.protection_outcome_model == "confirm"
                order.emit(manifest.scenario, "protection_accepted" if confirmed
                    else "protection_rejected", when,
                    protection_order_id=order.permit.protection_order_id)
                order.rejected = not confirmed
        current_books = sorted(books.get(when, ()), key=lambda row:
            (row.source_id, row.source_event_id, row.raw_payload_hash))
        # A newly accepted order can use the last already available book's
        # *remaining* visible depth; old orders do not receive a synthetic refill.
        seen_books = {canonical_hash(row.model_dump(mode="json"))
                      for row in current_books}
        for order in new:
            if order.rejected or any(row.instrument_version_id ==
                    order.instrument.instrument_version_id for row in current_books):
                continue
            prior = [row for row in ordered_books if
                row.instrument_version_id == order.instrument.instrument_version_id
                and row.available_at <= when]
            if prior:
                row = prior[-1]
                row_hash = canonical_hash(row.model_dump(mode="json"))
                if row_hash not in seen_books:
                    current_books.append(row)
                    seen_books.add(row_hash)
        for row in current_books:
            active = sorted((order for order in orders if
                order.instrument.instrument_version_id == row.instrument_version_id and
                order.envelope.accepted_at_cursor <= when <
                    order.envelope.time_in_force_cursor and
                when <= cancel_at.get(order.permit.order_id,
                                      order.envelope.time_in_force_cursor)),
                key=lambda item: (item.envelope.accepted_at_cursor,
                                  item.permit.order_ordinal, item.permit.order_id))
            for order in active:
                _fill_book(order, row, when, manifest, consumed, positions)
        for order in expiry.get(when, ()):
            if order.rejected or not order.remaining:
                continue
            reason = ("envelope_exhausted" if order.exhausted else
                "residual_time_in_force" if order.filled else
                "price_limit_unfilled" if order.saw_adverse_price else
                "time_in_force_expired")
            order.emit(manifest.scenario, "cancelled", when,
                       terminal_reason=reason)
    result = tuple(sorted((event for order in orders for event in order.events),
        key=lambda item: (item.simulation_cursor_at, item.order_ordinal,
                          item.sequence, item.source_event_id)))
    if len({item.source_event_id for item in result}) != len(result):
        raise FinanceError("causal replay repeats a source event identity")
    return overlay_cancel_events(manifest, permits, result, cancel_receipts)
