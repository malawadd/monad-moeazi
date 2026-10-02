"""Replay linear position effects against an issuance-frozen reduction anchor."""
from __future__ import annotations

from fractions import Fraction
from math import ceil

from .finance_contracts import FinanceError, native_int
from .lifecycle_contracts import ExecutionEvent, ExecutionPermit
from .lifecycle_position_math import calculate_fill_effect, empty_position_state
from .lifecycle_position_math_contracts import FillEffect, PositionArithmeticState
from .observation_contracts import InstrumentVersion


class CausalPositionTracker:
    def __init__(self, anchors: dict[str, PositionArithmeticState],
                 margin_bps: int | None):
        self.anchors = anchors
        self.margin_bps = margin_bps
        self.states: dict[tuple[str, str], PositionArithmeticState] = {}
        self.checked: set[str] = set()

    def candidate(self, permit: ExecutionPermit, instrument: InstrumentVersion,
                  event: ExecutionEvent) -> tuple[FillEffect, int]:
        if self.margin_bps is None:
            raise FinanceError("linear replay lacks its frozen margin policy")
        key = permit.instrument_version_id, permit.location_id
        state = self.states.get(key)
        anchor = self.anchors.get(permit.order_id)
        if permit.action in {"perp_reduce", "perp_close"}:
            if anchor is None or permit.execution_envelope is None or \
                    permit.execution_envelope.position_state_hash is None:
                raise FinanceError("linear reduction lacks its frozen position anchor")
            if permit.order_id not in self.checked:
                if state != anchor:
                    raise FinanceError("linear reduction anchor differs from source chronology")
                self.checked.add(permit.order_id)
        elif anchor is not None:
            raise FinanceError("increasing order cannot borrow a reduction anchor")
        if state is None:
            state = empty_position_state(permit, instrument)
        effect = calculate_fill_effect(state, permit, event, instrument,
                                       margin_bps=self.margin_bps)
        realized = Fraction(native_int(effect.realized_pnl_delta_numerator),
                            native_int(effect.realized_pnl_delta_denominator,
                                       positive=True))
        loss = ceil(-realized) if realized < 0 else 0
        return effect, loss

    def commit(self, permit: ExecutionPermit, effect: FillEffect) -> None:
        self.states[(permit.instrument_version_id,
                     permit.location_id)] = effect.new_state


def wallet_debits(effect: FillEffect) -> dict[tuple[str, str, str], int]:
    result: dict[tuple[str, str, str], int] = {}
    for row in effect.deltas:
        if row.book == "wallet" and native_int(row.units) < 0:
            key = row.asset_unit_id, row.registry_hash, row.location_id
            result[key] = result.get(key, 0) - native_int(row.units)
    return result
