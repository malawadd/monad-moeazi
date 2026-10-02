"""Scoped SQL projection of exact position arithmetic after a folded source fact."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, _digest, db_native_int, native_int
from .lifecycle_contracts import ExecutionPermit
from .lifecycle_position_math import empty_position_state
from .lifecycle_position_math_contracts import FillEffect, PositionArithmeticState
from .lifecycle_run_store import _run_params
from .observation_contracts import InstrumentVersion


async def load_position_state(conn, permit: ExecutionPermit,
                              instrument: InstrumentVersion
                              ) -> tuple[PositionArithmeticState, dict | None]:
    params = _run_params(permit.scope, permit.run_id)
    row = (await conn.execute(text("""
        SELECT * FROM simulation_positions WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id AND instrument_version_id=:instrument
          AND location_id=:location FOR UPDATE
    """), {**params, "instrument": permit.instrument_version_id,
           "location": permit.location_id})).mappings().first()
    if row is None:
        return empty_position_state(permit, instrument), None
    if row["arithmetic_state_json"] is None or row["arithmetic_state_hash"] is None:
        raise FinanceError("persisted position has no exact rational state")
    state = PositionArithmeticState.model_validate_json(
        json.dumps(row["arithmetic_state_json"]))
    digest = _digest("moeazi-position-arithmetic-v1", state.model_dump(mode="json"))
    if digest != row["arithmetic_state_hash"] or state.scope != permit.scope or \
            state.run_id != permit.run_id or \
            state.instrument_version_id != permit.instrument_version_id or \
            state.location_id != permit.location_id or \
            native_int(state.signed_quantity_units) != \
            db_native_int(row["signed_exposure_units"]) or \
            native_int(state.collateral_units) != db_native_int(row["collateral_units"]):
        raise FinanceError("persisted position projection differs from exact state")
    return state, dict(row)


async def write_position_effect(conn, permit: ExecutionPermit,
                                instrument: InstrumentVersion, effect: FillEffect,
                                previous: dict | None, *, filled_units: int,
                                ) -> int:
    state = effect.new_state
    if state.scope != permit.scope or state.run_id != permit.run_id or \
            state.instrument_version_id != instrument.instrument_version_id or \
            state.location_id != permit.location_id or filled_units < 0:
        raise FinanceError("position effect differs from submitted order")
    params = _run_params(permit.scope, permit.run_id)
    digest = _digest("moeazi-position-arithmetic-v1", state.model_dump(mode="json"))
    common = {**params, "instrument": state.instrument_version_id,
              "location": state.location_id,
              "exposure": state.signed_quantity_units,
              "attributed": filled_units + (db_native_int(previous["attributed_filled_units"])
                                             if previous else 0),
              "cost_num": state.open_cost_numerator,
              "cost_den": state.open_cost_denominator,
              "pnl_num": state.realized_pnl_numerator,
              "pnl_den": state.realized_pnl_denominator,
              "collateral_asset": state.settlement_asset_unit_id if
                  state.quantity_kind == "contracts" else None,
              "collateral": state.collateral_units,
              "arithmetic": json.dumps(state.model_dump(mode="json"),
                                       sort_keys=True, separators=(",", ":"),
                                       ensure_ascii=False),
              "arithmetic_hash": digest,
              "controller": json.dumps(permit.controller_ref.model_dump(),
                                       sort_keys=True, separators=(",", ":")),
              "kind": state.quantity_kind}
    if previous is None:
        await conn.execute(text("""
            INSERT INTO simulation_positions(environment,scope_id,strategy_account_id,
              run_id,instrument_version_id,location_id,originating_controller_ref,
              management_controller_ref,quantity_kind,signed_exposure_units,
              attributed_filled_units,cost_basis_numerator,cost_basis_denominator,
              realized_pnl_numerator,realized_pnl_denominator,collateral_asset_unit_id,
              collateral_units,reconciliation_state,pending_obligations,reason,
              revision,arithmetic_state_json,arithmetic_state_hash)
            VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:instrument,
              :location,CAST(:controller AS jsonb),CAST(:controller AS jsonb),:kind,
              :exposure,:attributed,:cost_num,:cost_den,:pnl_num,:pnl_den,
              :collateral_asset,:collateral,'awaiting_checkpoint',true,
              'simulated_event_unreconciled',1,CAST(:arithmetic AS jsonb),
              :arithmetic_hash)
        """), common)
        return 1
    if previous["quantity_kind"] != state.quantity_kind or \
            previous["originating_controller_ref"] != \
            permit.controller_ref.model_dump() or \
            previous["management_controller_ref"] != \
            permit.controller_ref.model_dump():
        raise FinanceError("position management authority differs")
    revision = previous["revision"] + 1
    changed = await conn.execute(text("""
        UPDATE simulation_positions SET signed_exposure_units=:exposure,
          attributed_filled_units=:attributed,cost_basis_numerator=:cost_num,
          cost_basis_denominator=:cost_den,realized_pnl_numerator=:pnl_num,
          realized_pnl_denominator=:pnl_den,collateral_asset_unit_id=:collateral_asset,
          collateral_units=:collateral,reconciliation_state='awaiting_checkpoint',
          pending_obligations=true,reason='simulated_event_unreconciled',
          revision=:revision,arithmetic_state_json=CAST(:arithmetic AS jsonb),
          arithmetic_state_hash=:arithmetic_hash,updated_at=clock_timestamp()
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND instrument_version_id=:instrument AND location_id=:location
          AND revision=:old_revision
    """), {**common, "revision": revision,
           "old_revision": previous["revision"]})
    if changed.rowcount != 1:
        raise FinanceError("position revision changed during event fold")
    return revision
