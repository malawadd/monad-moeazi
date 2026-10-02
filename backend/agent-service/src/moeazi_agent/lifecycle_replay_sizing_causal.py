"""Decision-time limits for a bounded causal experiment order."""
from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from fractions import Fraction

from .finance_contracts import FinanceError, ReservationComponent, _digest, native_int
from .finance_policy import SizingPolicy
from .lifecycle_decision import ReplayDecisionContext
from .lifecycle_execution_envelope import (
    CAUSAL_MODEL_VERSION, EnvelopeAssetLimit, ExecutionEnvelopeV1,
)
from .lifecycle_position_math_contracts import PositionArithmeticState, exact_pair
from .lifecycle_replay_finance_contracts import ReplaySizingReceipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_simulator import CAUSAL_MODEL_HASH
from .observation_contracts import InstrumentVersion, MarketObservation


def _ceil(value: Fraction) -> int:
    return -(-value.numerator // value.denominator)


def causal_replay_receipt(base: ReplaySizingReceipt,
        manifest: SimulationRunManifest, decision: ReplayDecisionContext,
    policy: SizingPolicy, instrument: InstrumentVersion,
    selected_book: MarketObservation,
    state: PositionArithmeticState | None,
    current_quantity: int, pending_open_notional: int, *,
    position_revision: int | None) -> ReplaySizingReceipt:
    """Use only selected pre-dispatch evidence and declared rules for a hold."""
    scenario = manifest.scenario
    if scenario.model_version != CAUSAL_MODEL_VERSION or \
            scenario.model_hash != CAUSAL_MODEL_HASH or \
            base.scope != manifest.scope or base.run_id != manifest.run_id or \
            base.decision_hash != decision.decision_hash or \
            base.instrument_version_id != instrument.instrument_version_id or \
            selected_book.available_at > decision.cursor_at:
        raise FinanceError("causal receipt lacks exact decision-time provenance")
    deviation = scenario.max_execution_deviation_bps
    tif_ms = scenario.order_time_in_force_ms
    max_fills = scenario.max_fill_events_per_order
    if deviation is None or tif_ms is None or max_fills is None:
        raise FinanceError("causal model lacks frozen execution limits")
    if scenario.funding_rules or scenario.outcome_rules:
        raise FinanceError("causal funding and outcomes lack retained source support")
    if base.action in {"perp_reduce", "perp_close"}:
        raise FinanceError("causal reduction needs an immutable position anchor")
    if position_revision is not None and (
            type(position_revision) is not int or position_revision <= 0 or
            state is None or base.action != "spot_sell"):
        raise FinanceError("causal position revision lacks a spot reduction state")
    position_hash = (_digest("moeazi-position-arithmetic-v1",
        state.model_dump(mode="json")) if position_revision is not None and
        state is not None else None)
    if any(rule.order_ordinal == base.order_ordinal and
           rule.fill_ordinal > max_fills for rule in scenario.fee_rules):
        raise FinanceError("exact fee rule exceeds declared fill count")
    increasing = base.action in {"spot_buy", "perp_open", "perp_increase"}
    if increasing and manifest.protection_policy is None:
        raise FinanceError("causal increasing order needs bounded protection policy")
    accepted_at = decision.cursor_at + timedelta(milliseconds=scenario.latency_ms)
    if (accepted_at - selected_book.event_at).total_seconds() * 1000 > \
            scenario.max_book_age_ms:
        raise FinanceError("known decision book expires before causal acceptance")
    end = scenario.simulation_end_at
    if increasing:
        end -= timedelta(seconds=manifest.protection_policy.maximum_unprotected_seconds)
    tif = min(accepted_at + timedelta(milliseconds=tif_ms), end)
    if not accepted_at < tif:
        raise FinanceError("causal order has no in-horizon time in force")
    scale = Fraction(10 ** instrument.quote_decimals, 10 ** instrument.base_decimals)
    ask = Fraction(selected_book.asks[0].price_quote_per_base) * scale
    bid = Fraction(selected_book.bids[0].price_quote_per_base) * scale
    limit = (ask * (10_000 + deviation) / 10_000 if base.side == "buy"
             else bid * (10_000 - deviation) / 10_000)
    upper_mark = ask * (10_000 + deviation) / 10_000
    if limit <= 0:
        raise FinanceError("causal limit price must stay positive")
    size = native_int(base.contract_size_units, positive=True) \
        if base.quantity_kind == "contracts" else 1
    quantity = native_int(base.quantity_units, positive=True)
    limit_notional = _ceil(Fraction(quantity * size) * limit)
    risk_notional = _ceil(Fraction(quantity * size) * upper_mark)
    cap = min(native_int(policy.max_gross_notional_units),
              native_int(policy.max_directional_notional_units))
    if increasing and _ceil(Fraction(abs(current_quantity) * size) * upper_mark) + \
            pending_open_notional + risk_notional > cap:
        raise FinanceError("causal worst-mark exposure exceeds instrument cap")
    default_fee = (_ceil(Fraction(risk_notional * scenario.fee_bps, 10_000)) +
                   max_fills - 1 if scenario.fee_bps else 0)
    fee_ceiling = native_int(base.fee_budget_quote_units, nonnegative=True)
    if fee_ceiling < default_fee:
        raise FinanceError("causal fee ceiling misses per-fill rounding bound")
    increments: dict[tuple[str, str], int] = defaultdict(int)
    quote = base.quote_asset_unit_id, base.quote_registry_hash
    settlement = base.settlement_asset_unit_id, base.settlement_registry_hash
    if base.action == "spot_buy":
        # Each partial trade cost rounds up independently in native quote units.
        increments[quote] += limit_notional - native_int(base.notional_units) + \
            max_fills - 1
    elif base.action in {"perp_open", "perp_increase"}:
        previous_cost = exact_pair(state.open_cost_numerator,
            state.open_cost_denominator) if state else Fraction(0)
        previous_margin = native_int(state.margin_reserved_units) if state else 0
        new_margin = _ceil((previous_cost + quantity * size * upper_mark) *
                           policy.initial_margin_bps / 10_000) - previous_margin
        old_margin = next((native_int(part.units) - fee_ceiling -
                           native_int(policy.exit_buffer_units)
                           for part in base.components if
                           (part.asset_unit_id, part.registry_hash) == settlement), None)
        exact_rules = sum(native_int(rule.units) for rule in scenario.fee_rules
            if rule.order_ordinal == base.order_ordinal and
            (rule.asset_unit_id, rule.registry_hash) == settlement)
        if old_margin is None:
            raise FinanceError("causal margin has no settlement hold")
        increments[settlement] += new_margin - (old_margin - exact_rules)
    loss = Fraction(0)
    if base.action in {"perp_reduce", "perp_close"}:
        if state is None or not current_quantity:
            raise FinanceError("causal reduction has no exact open basis")
        removed = exact_pair(state.open_cost_numerator,
                             state.open_cost_denominator) * quantity / abs(current_quantity)
        proceeds = Fraction(quantity * size) * limit
        loss = max(Fraction(0), (removed - proceeds if current_quantity > 0
                                 else proceeds - removed))
        if _ceil(loss) > native_int(state.collateral_units):
            raise FinanceError("causal worst close loss exceeds collateral")
    components = tuple(ReservationComponent(
        capacity_key=part.capacity_key, asset_unit_id=part.asset_unit_id,
        registry_hash=part.registry_hash, location_id=part.location_id,
        units=str(native_int(part.units) + increments[
            (part.asset_unit_id, part.registry_hash)]))
        for part in base.components)
    fee_caps: dict[tuple[str, str], int] = defaultdict(int)
    fee_caps[quote] += fee_ceiling
    for rule in scenario.fee_rules:
        if rule.order_ordinal == base.order_ordinal:
            fee_caps[(rule.asset_unit_id, rule.registry_hash)] += \
                native_int(rule.units, nonnegative=True)
    liabilities = tuple(EnvelopeAssetLimit(asset_unit_id=part.asset_unit_id,
        registry_hash=part.registry_hash, location_id=part.location_id,
        max_wallet_debit_units=part.units,
        max_fee_units=str(fee_caps[(part.asset_unit_id, part.registry_hash)]))
        for part in components)
    envelope_body = dict(schema_version=1, model_version=CAUSAL_MODEL_VERSION,
        scope=base.scope, run_id=base.run_id, manifest_hash=base.manifest_hash,
        decision_hash=base.decision_hash,
        selected_observation_hash=base.selected_observation_hash,
        account_snapshot_hash=base.account_snapshot_hash,
        account_revision=base.account_revision,
        instrument_version_id=base.instrument_version_id,
        instrument_registry_hash=base.instrument_registry_hash,
        action=base.action, side=base.side, quantity_kind=base.quantity_kind,
        location_id=base.location_id, issued_at_cursor=decision.cursor_at,
        accepted_at_cursor=accepted_at, time_in_force_cursor=tif,
        limit_price_numerator=str(limit.numerator),
        limit_price_denominator=str(limit.denominator),
        max_quantity_units=base.quantity_units, max_fill_events=max_fills,
        liabilities=liabilities,
        collateral_loss_asset_unit_id=base.settlement_asset_unit_id if
            base.quantity_kind == "contracts" else None,
        collateral_loss_registry_hash=base.settlement_registry_hash if
            base.quantity_kind == "contracts" else None,
        max_collateral_loss_units=str(_ceil(loss)) if
            base.quantity_kind == "contracts" else None,
        position_state_hash=position_hash,
        position_revision=position_revision)
    envelope_json = ExecutionEnvelopeV1.model_construct(**envelope_body).model_dump(
        mode="json", exclude={"envelope_hash"})
    envelope = ExecutionEnvelopeV1.model_validate({**envelope_body,
        "envelope_hash": _digest("moeazi-execution-envelope-v1", envelope_json)})
    body = {name: getattr(base, name) for name in type(base).model_fields
            if name != "receipt_hash"}
    body.update(code_version="replay-sizing-v2", components=components,
        price_numerator=str(limit.numerator),
        price_denominator=str(limit.denominator),
        notional_units=str(limit_notional), risk_notional_units=str(risk_notional),
        execution_envelope=envelope,
        position_state_hash=position_hash,
        position_revision=position_revision,
        position_state=state if position_revision is not None else None)
    digest_body = ReplaySizingReceipt.model_construct(**body).model_dump(
        mode="json", exclude={"receipt_hash"})
    return ReplaySizingReceipt.model_validate({**body,
        "receipt_hash": _digest("moeazi-replay-sizing-v2", digest_body)})
