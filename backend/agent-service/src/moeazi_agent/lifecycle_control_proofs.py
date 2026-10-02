"""Read-only terminal control proofs; never settle capacity or edit positions."""
import json

from sqlalchemy import text

from .finance_contracts import FinanceError, _digest, db_native_int, native_int
from .lifecycle_contracts import ExecutionEvent, ExecutionPermit
from .lifecycle_position_math_contracts import PositionArithmeticState


async def terminal_order_fact(conn, params, order):
    if order["status"] not in {"filled", "cancelled", "rejected"}:
        return None
    permit = ExecutionPermit.model_validate_json(json.dumps(order["permit_json"]))
    if permit.permit_hash != order["permit_hash"] or permit.order_id != order["order_id"] or \
            permit.scope.model_dump() != {k: params[k] for k in
                ("environment", "scope_id", "strategy_account_id")} or \
            permit.run_id != params["run_id"] or \
            permit.run_manifest_hash != params["manifest_hash"] or \
            permit.reservation_id != order["reservation_id"] or \
            native_int(permit.quantity_units) != db_native_int(order["quantity_units"]):
        raise FinanceError("Control terminal order lacks its exact permit")
    if any(order[key] != getattr(permit, key) for key in (
            "order_ordinal", "intent_id", "intent_hash", "client_id", "attempt_id",
            "normalized_payload_hash", "instrument_version_id", "action", "side",
            "quantity_kind")):
        raise FinanceError("Control terminal order projection differs from permit")
    held = (await conn.execute(text("""
        SELECT status FROM finance_reservations WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND reservation_id=:reservation
    """), {**params, "reservation": order["reservation_id"]})).scalar_one()
    if held not in {"settled", "released"}:
        return None
    rows = (await conn.execute(text("""
        SELECT e.event_hash,e.event_json,f.event_kind,f.transaction_id
        FROM simulation_order_events e JOIN simulation_event_folds f
          USING(environment,scope_id,strategy_account_id,run_id,event_hash)
        WHERE e.environment=:environment AND e.scope_id=:scope_id
          AND e.strategy_account_id=:strategy_account_id AND e.run_id=:run_id
          AND e.order_id=:order_id AND e.kind IN ('fill','cancelled','rejected','protection_rejected')
        ORDER BY e.simulation_cursor_at DESC,e.sequence DESC
    """), {**params, "order_id": order["order_id"]})).mappings().all()
    for row in rows:
        event = ExecutionEvent.model_validate_json(json.dumps(row["event_json"]))
        if event.event_hash != row["event_hash"] or event.kind != row["event_kind"] or \
                event.order_id != order["order_id"] or event.permit_hash != order["permit_hash"] or \
                event.run_manifest_hash != permit.run_manifest_hash or \
                event.instrument_version_id != permit.instrument_version_id or \
                event.client_id != permit.client_id or event.attempt_id != permit.attempt_id or \
                event.order_ordinal != permit.order_ordinal or \
                (event.kind == "protection_rejected" and
                 event.protection_order_id != permit.protection_order_id) or \
                event.simulation_cursor_at > params["cursor"] or \
                event.scope.model_dump() != {k: params[k] for k in
                    ("environment", "scope_id", "strategy_account_id")} or \
                event.run_id != params["run_id"]:
            raise FinanceError("Control terminal proof differs from submitted order")
        if native_int(event.cumulative_filled_units) != db_native_int(order["cumulative_filled_units"]):
            continue
        if order["status"] == "filled":
            if event.kind == "fill" and native_int(event.cumulative_filled_units) == \
                    db_native_int(order["quantity_units"]) and row["transaction_id"]:
                return event
        elif event.kind == order["status"] or \
                (order["status"] == "rejected" and event.kind == "protection_rejected"):
            return event
    return None


async def flat_instrument_proof(conn, scope, params, instrument):
    positions = (await conn.execute(text("""
        SELECT * FROM simulation_positions WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND instrument_version_id=:instrument
    """), {**params, "instrument": instrument})).mappings().all()
    if not positions or any(row["run_id"] != params["run_id"] for row in positions):
        return None
    hashes = []
    for row in positions:
        if row["reconciliation_state"] != "clean" or row["pending_obligations"] or \
                row["arithmetic_state_json"] is None:
            return None
        state = PositionArithmeticState.model_validate_json(json.dumps(row["arithmetic_state_json"]))
        digest = _digest("moeazi-position-arithmetic-v1", state.model_dump(mode="json"))
        if state.scope != scope or state.run_id != params["run_id"] or \
                state.instrument_version_id != instrument or state.location_id != row["location_id"] or \
                digest != row["arithmetic_state_hash"] or \
                native_int(state.signed_quantity_units) != db_native_int(row["signed_exposure_units"]) or \
                native_int(state.collateral_units) != db_native_int(row["collateral_units"]):
            raise FinanceError("Flat control proof differs from exact position state")
        if any(native_int(value) for value in (state.signed_quantity_units,
                state.margin_reserved_units, state.collateral_units)):
            return None
        hashes.append(digest)
    pending = (await conn.execute(text("""
        SELECT EXISTS(SELECT 1 FROM simulation_intents i
          JOIN finance_reservations r USING(environment,scope_id,strategy_account_id,intent_id)
          WHERE i.environment=:environment AND i.scope_id=:scope_id
            AND i.strategy_account_id=:strategy_account_id
            AND i.intent_json->>'instrument_version_id'=:instrument
            AND r.status NOT IN ('settled','released')) OR
          EXISTS(SELECT 1 FROM simulation_protections WHERE environment=:environment
            AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            AND instrument_version_id=:instrument AND resolution_hash IS NULL
            AND status IN ('intended','requested','confirmed','rejected','uncertain'))
    """), {**params, "instrument": instrument})).scalar_one()
    if pending:
        return None
    orders = (await conn.execute(text("""
        SELECT * FROM simulation_orders WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND instrument_version_id=:instrument ORDER BY order_ordinal
    """), {**params, "instrument": instrument})).mappings().all()
    if not orders or any(row["run_id"] != params["run_id"] for row in orders):
        return None
    facts = [await terminal_order_fact(conn, params, order) for order in orders]
    if any(fact is None for fact in facts):
        return None
    return {"positionHashes": sorted(hashes),
            "terminalEventHashes": [fact.event_hash for fact in facts]}
