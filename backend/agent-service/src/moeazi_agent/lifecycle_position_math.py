"""Exact Q4 spot/linear-perp position effects, without database or signing authority."""
from __future__ import annotations

from collections import defaultdict
from fractions import Fraction

from .finance_contracts import FinanceError, native_int
from .lifecycle_contracts import ExecutionEvent, ExecutionPermit
from .lifecycle_position_math_contracts import (
    AssetBookDelta, AssetTotal, FillEffect, PositionArithmeticState, exact_pair,
)
from .observation_contracts import InstrumentVersion


def _ceil(value: Fraction) -> int:
    return -(-value.numerator // value.denominator)


def _floor(value: Fraction) -> int:
    return value.numerator // value.denominator


def _truncate(value: Fraction) -> int:
    return _floor(value) if value >= 0 else _ceil(value)


def _pair(value: Fraction) -> dict[str, str]:
    return {"numerator": str(value.numerator), "denominator": str(value.denominator)}


def _totals(rows: tuple[AssetTotal, ...], asset: str,
            registry: str, amount: int) -> tuple[AssetTotal, ...]:
    values = {(row.asset_unit_id, row.registry_hash): native_int(row.signed_units)
              for row in rows}
    values[(asset, registry)] = values.get((asset, registry), 0) + amount
    return tuple(AssetTotal(asset_unit_id=key[0], registry_hash=key[1],
                            signed_units=str(value))
                 for key, value in sorted(values.items()))


def _deltas(values: dict[tuple[str, str, str, str], int]) -> tuple[AssetBookDelta, ...]:
    return tuple(AssetBookDelta(asset_unit_id=key[0], registry_hash=key[1],
                               location_id=key[2], book=key[3], units=str(amount))
                 for key, amount in sorted(values.items()) if amount)


def empty_position_state(permit: ExecutionPermit,
                         instrument: InstrumentVersion) -> PositionArithmeticState:
    """Construct an explicit zero position; account balances remain SQL-owned."""
    if permit.instrument_version_id != instrument.instrument_version_id or \
            permit.instrument_registry_hash != instrument.registry_hash or \
            permit.scope.environment != "experiment":
        raise FinanceError("empty position identity differs from permit")
    return PositionArithmeticState(
        scope=permit.scope, run_id=permit.run_id,
        instrument_version_id=instrument.instrument_version_id,
        instrument_registry_hash=instrument.registry_hash,
        location_id=permit.location_id, quantity_kind=permit.quantity_kind,
        base_asset_unit_id=instrument.base_asset_unit_id,
        base_registry_hash=permit.quantity_registry_hash,
        settlement_asset_unit_id=instrument.settlement_asset_unit_id,
        settlement_registry_hash=permit.settlement_registry_hash,
        signed_quantity_units="0", contract_size_unit_id=permit.contract_size_unit_id,
        contract_size_units=permit.contract_size_units,
        open_cost_numerator="0", open_cost_denominator="1",
        realized_pnl_numerator="0", realized_pnl_denominator="1",
        unrealized_pnl_numerator="0", unrealized_pnl_denominator="1",
        mark_price_numerator=None, mark_price_denominator=None,
        margin_reserved_units="0", collateral_units="0",
        fee_totals=(), funding_totals=())


def _check_fill(state: PositionArithmeticState, permit: ExecutionPermit,
                event: ExecutionEvent, instrument: InstrumentVersion,
                margin_bps: int) -> tuple[int, Fraction, int]:
    if event.kind != "fill" or event.scope != state.scope or \
            permit.scope != state.scope or event.run_id != state.run_id or \
            permit.run_id != state.run_id or \
            event.instrument_version_id != state.instrument_version_id or \
            permit.instrument_version_id != state.instrument_version_id or \
            instrument.instrument_version_id != state.instrument_version_id or \
            instrument.registry_hash != state.instrument_registry_hash or \
            permit.instrument_registry_hash != state.instrument_registry_hash or \
            event.order_id != permit.order_id or event.attempt_id != permit.attempt_id or \
            event.client_id != permit.client_id or \
            event.order_ordinal != permit.order_ordinal or \
            event.run_manifest_hash != permit.run_manifest_hash or \
            event.permit_hash != permit.permit_hash or \
            event.quantity_kind != state.quantity_kind or \
            event.contract_size_units != state.contract_size_units or \
            event.contract_size_unit_id != state.contract_size_unit_id or \
            permit.location_id != state.location_id or \
            permit.quantity_asset_unit_id != state.base_asset_unit_id or \
            permit.settlement_asset_unit_id != state.settlement_asset_unit_id or \
            permit.quote_asset_unit_id != instrument.quote_asset_unit_id or \
            permit.quantity_registry_hash != state.base_registry_hash or \
            permit.settlement_registry_hash != state.settlement_registry_hash:
        raise FinanceError("fill, permit, instrument, and position identity differ")
    if instrument.base_asset_unit_id != state.base_asset_unit_id or \
            instrument.settlement_asset_unit_id != state.settlement_asset_unit_id or \
            (state.quantity_kind == "asset_native" and instrument.product_kind != "spot") or \
            (state.quantity_kind == "contracts" and
             (instrument.product_kind != "perpetual" or
              instrument.margin_model != "linear_v1" or
              instrument.quote_asset_unit_id != instrument.settlement_asset_unit_id or
              instrument.quote_decimals != instrument.settlement_decimals)):
        raise FinanceError("unsupported spot or linear perpetual definition")
    if type(margin_bps) is not int or not 0 <= margin_bps <= 10_000 or \
            (state.quantity_kind == "contracts" and margin_bps == 0):
        raise FinanceError("margin policy has an invalid basis point rate")
    quantity = native_int(event.fill_quantity_units or "0", positive=True)
    if quantity > native_int(permit.quantity_units, positive=True) or \
            native_int(event.cumulative_filled_units) < quantity or \
            native_int(event.cumulative_filled_units) > native_int(permit.quantity_units):
        raise FinanceError("fill exceeds immutable permit quantity")
    price = Fraction(native_int(event.price_numerator or "0", positive=True),
                     native_int(event.price_denominator or "0", positive=True))
    size = native_int(state.contract_size_units, positive=True) \
        if state.quantity_kind == "contracts" and state.contract_size_units else 1
    if state.quantity_kind == "contracts" and \
            Fraction(instrument.contract_multiplier) * 10 ** instrument.base_decimals != size:
        raise FinanceError("fill contract size differs from frozen instrument")
    return quantity, price, size


def calculate_fill_effect(state: PositionArithmeticState, permit: ExecutionPermit,
                          event: ExecutionEvent, instrument: InstrumentVersion,
                          *, margin_bps: int) -> FillEffect:
    """Return wallet/collateral-side deltas; repository adds clearing counterposts."""
    state = PositionArithmeticState.model_validate(state.model_dump(mode="python"))
    permit = ExecutionPermit.model_validate(permit.model_dump(mode="python"))
    event = ExecutionEvent.model_validate(event.model_dump(mode="python"))
    quantity, price, size = _check_fill(state, permit, event, instrument, margin_bps)
    before = native_int(state.signed_quantity_units)
    signed = quantity if permit.side == "buy" else -quantity
    after = before + signed
    cost = exact_pair(state.open_cost_numerator, state.open_cost_denominator)
    realized = exact_pair(state.realized_pnl_numerator, state.realized_pnl_denominator)
    notional = quantity * size * price
    settlement = (state.settlement_asset_unit_id, state.settlement_registry_hash,
                  state.location_id)
    base = (state.base_asset_unit_id, state.base_registry_hash, state.location_id)
    delta: dict[tuple[str, str, str, str], int] = defaultdict(int)
    realized_change = Fraction(0)
    margin_before = native_int(state.margin_reserved_units, nonnegative=True)
    collateral_before = native_int(state.collateral_units, nonnegative=True)
    margin_after = margin_before
    collateral_after = collateral_before

    if state.quantity_kind == "asset_native":
        if permit.action not in {"spot_buy", "spot_sell"} or after < 0:
            raise FinanceError("Q4 spot fill would exceed held long inventory")
        delta[(*base, "wallet")] += signed
        if signed > 0:
            paid = _ceil(notional)
            delta[(*settlement, "wallet")] -= paid
            cost += paid
        else:
            proceeds = _floor(notional)
            removed = cost * quantity / before
            cost -= removed
            realized_change = proceeds - removed
            delta[(*settlement, "wallet")] += proceeds
    else:
        if permit.action not in {"perp_open", "perp_increase", "perp_reduce",
                                 "perp_close"}:
            raise FinanceError("unsupported linear perpetual action")
        increases = before == 0 or (before > 0) == (signed > 0)
        if increases and permit.action not in {"perp_open", "perp_increase"} or \
                not increases and permit.action not in {"perp_reduce", "perp_close"} or \
                not increases and quantity > abs(before):
            raise FinanceError("perpetual fill contradicts open exposure or action")
        if increases:
            cost += notional
            margin_after = _ceil(cost * margin_bps / 10_000)
            transfer = margin_after - margin_before
            collateral_after += transfer
            delta[(*settlement, "wallet")] -= transfer
            delta[(*settlement, "collateral")] += transfer
        else:
            removed = cost * quantity / abs(before)
            cost -= removed
            realized_change = (notional - removed) * (1 if before > 0 else -1)
            margin_after = _ceil(cost * margin_bps / 10_000)
            release = margin_before - margin_after
            settled_gain = _truncate(realized + realized_change) - _truncate(realized)
            collateral_after += settled_gain - release
            delta[(*settlement, "wallet")] += release
            delta[(*settlement, "collateral")] += settled_gain - release
            if after == 0:
                delta[(*settlement, "wallet")] += collateral_after
                delta[(*settlement, "collateral")] -= collateral_after
                collateral_after = 0
        if collateral_after < 0:
            raise FinanceError("perpetual loss exceeds available collateral")
    if after == 0:
        cost = Fraction(0)
    realized += realized_change
    fee_totals = state.fee_totals
    if event.fee_units is not None:
        fee = native_int(event.fee_units, nonnegative=True)
        if not event.fee_asset_unit_id or not event.fee_registry_hash:
            raise FinanceError("fill fee lacks exact asset registry")
        delta[(event.fee_asset_unit_id, event.fee_registry_hash,
               state.location_id, "wallet")] -= fee
        fee_totals = _totals(fee_totals, event.fee_asset_unit_id,
                             event.fee_registry_hash, fee)
    market = abs(after) * size * price
    unrealized = (market - cost) * (1 if after >= 0 else -1) if after else Fraction(0)
    updates = {
        "signed_quantity_units": str(after),
        "open_cost_numerator": str(cost.numerator),
        "open_cost_denominator": str(cost.denominator),
        "realized_pnl_numerator": str(realized.numerator),
        "realized_pnl_denominator": str(realized.denominator),
        "unrealized_pnl_numerator": str(unrealized.numerator),
        "unrealized_pnl_denominator": str(unrealized.denominator),
        "mark_price_numerator": str(price.numerator),
        "mark_price_denominator": str(price.denominator),
        "margin_reserved_units": str(margin_after),
        "collateral_units": str(collateral_after),
        "fee_totals": fee_totals,
    }
    new_state = PositionArithmeticState.model_validate({
        **state.model_dump(mode="python"), **updates})
    return FillEffect(new_state=new_state, deltas=_deltas(delta),
        realized_pnl_delta_numerator=str(realized_change.numerator),
        realized_pnl_delta_denominator=str(realized_change.denominator),
        unrealized_pnl_numerator=str(unrealized.numerator),
        unrealized_pnl_denominator=str(unrealized.denominator),
        collateral_delta_units=str(collateral_after - collateral_before))


def calculate_funding_effect(state: PositionArithmeticState,
                             event: ExecutionEvent,
                             instrument: InstrumentVersion) -> FillEffect:
    """Signed funding stays in the declared settlement collateral asset."""
    state = PositionArithmeticState.model_validate(state.model_dump(mode="python"))
    event = ExecutionEvent.model_validate(event.model_dump(mode="python"))
    if event.kind != "funding" or state.quantity_kind != "contracts" or \
            instrument.product_kind != "perpetual" or \
            instrument.margin_model != "linear_v1" or \
            event.scope != state.scope or event.run_id != state.run_id or \
            event.instrument_version_id != state.instrument_version_id or \
            instrument.registry_hash != state.instrument_registry_hash or \
            event.quantity_kind != state.quantity_kind or \
            event.contract_size_unit_id != state.contract_size_unit_id or \
            event.contract_size_units != state.contract_size_units or \
            native_int(state.signed_quantity_units) == 0 or \
            event.funding_asset_unit_id != state.settlement_asset_unit_id or \
            event.funding_registry_hash != state.settlement_registry_hash:
        raise FinanceError("funding is not bound to an open linear settlement position")
    amount = native_int(event.funding_units or "0")
    collateral_after = native_int(state.collateral_units) + amount
    if collateral_after < 0:
        raise FinanceError("funding debit exceeds collateral")
    totals = _totals(state.funding_totals, state.settlement_asset_unit_id,
                     state.settlement_registry_hash, amount)
    updated = PositionArithmeticState.model_validate({
        **state.model_dump(mode="python"), "collateral_units": str(collateral_after),
        "funding_totals": totals})
    return FillEffect(new_state=updated, deltas=_deltas({
        (state.settlement_asset_unit_id, state.settlement_registry_hash,
         state.location_id, "collateral"): amount}),
        realized_pnl_delta_numerator="0", realized_pnl_delta_denominator="1",
        unrealized_pnl_numerator=state.unrealized_pnl_numerator,
        unrealized_pnl_denominator=state.unrealized_pnl_denominator,
        collateral_delta_units=str(amount))
