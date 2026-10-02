"""Transactional source-derived protection obligations, not execution authority."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError
from .lifecycle_maintenance_attempts import require_maintenance_attempt
from .lifecycle_protection_contracts import ProtectionObligation, make_protection_obligation
from .lifecycle_run_store import _run_params


async def _source(conn, event):
    row = (await conn.execute(text("""
        SELECT event_json FROM simulation_order_events WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id AND event_hash=:event
    """), {**_run_params(event.scope, event.run_id), "event": event.event_hash})).scalar_one_or_none()
    if row != event.model_dump(mode="json"):
        raise FinanceError("Protection lacks the exact persisted source event")


async def ensure_intended_protection(conn, event, permit, instrument,
                                     new_position_state, intent, position_revision):
    """Call after position write in the SAME fill/journal transaction."""
    if permit.action not in {"spot_buy", "perp_open", "perp_increase"} or \
            not intent.protection.required:
        return None
    obligation = make_protection_obligation(event, permit, instrument,
        new_position_state, intent, position_revision)
    await _source(conn, event)
    params = _run_params(permit.scope, permit.run_id)
    stored_intent = (await conn.execute(text("""
        SELECT intent_json FROM simulation_intents WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id AND intent_id=:intent
    """), {**params, "intent": intent.intent_id})).scalar_one_or_none()
    position = (await conn.execute(text("""
        SELECT revision,arithmetic_state_hash FROM simulation_positions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND instrument_version_id=:instrument AND location_id=:location FOR UPDATE
    """), {**params, "instrument": permit.instrument_version_id,
           "location": permit.location_id})).mappings().first()
    if stored_intent != intent.model_dump(mode="json") or position is None or \
            position["revision"] != obligation.position_revision or \
            position["arithmetic_state_hash"] != obligation.position_state_hash:
        raise FinanceError("Protection differs from persisted intent or resulting position")
    await conn.execute(text("""
        INSERT INTO simulation_protections(environment,scope_id,strategy_account_id,
          run_id,protection_order_id,instrument_version_id,location_id,
          originating_order_id,policy_hash,intended_hash,originating_event_hash,
          intended_json,status,reason)
        VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:protection,
          :instrument,:location,:origin,:policy,:hash,:event,CAST(:body AS jsonb),
          'intended','immediate_reduction_not_yet_requested') ON CONFLICT DO NOTHING
    """), {**params, "protection": obligation.protection_order_id,
        "instrument": obligation.instrument_version_id, "location": obligation.location_id,
        "origin": obligation.originating_order_id, "policy": obligation.policy_hash,
        "hash": obligation.intended_hash, "event": obligation.originating_event_hash,
        "body": obligation.model_dump_json()})
    row = (await conn.execute(text("""
        SELECT intended_hash,intended_json FROM simulation_protections
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND protection_order_id=:protection
    """), {**params, "protection": obligation.protection_order_id})).mappings().one()
    if row["intended_hash"] != obligation.intended_hash or \
            row["intended_json"] != obligation.model_dump(mode="json"):
        raise FinanceError("Protection fill obligation already has another identity")
    return obligation


async def _bound_request(conn, permit):
    if permit.protection_order_id != permit.order_id or not permit.originating_order_id or \
            permit.action not in {"spot_sell", "perp_reduce", "perp_close"}:
        raise FinanceError("Protection requires an actual reduction permit")
    params = {**_run_params(permit.scope, permit.run_id), "protection": permit.order_id}
    row = (await conn.execute(text("""
        SELECT * FROM simulation_protections WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id AND protection_order_id=:protection FOR UPDATE
    """), params)).mappings().first()
    if row is None or row["intended_json"] is None:
        raise FinanceError("Protection request lacks a source-bound obligation")
    obligation = ProtectionObligation.model_validate_json(json.dumps(row["intended_json"]))
    if obligation.scope != permit.scope or obligation.run_id != permit.run_id or \
            obligation.manifest_hash != permit.run_manifest_hash or \
            obligation.protection_order_id != permit.order_id or \
            obligation.originating_order_id != permit.originating_order_id or \
            obligation.instrument_version_id != permit.instrument_version_id or \
            obligation.location_id != permit.location_id or obligation.policy_hash != permit.policy_hash or \
            obligation.intended_hash != row["intended_hash"]:
        raise FinanceError("Protection request differs from its originating fill")
    stored = (await conn.execute(text("""
        SELECT permit_json FROM simulation_orders WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND run_id=:run_id AND order_id=:protection
    """), params)).scalar_one_or_none()
    if stored != permit.model_dump(mode="json"):
        raise FinanceError("Protection lacks its actual submitted order permit")
    return params, row


async def mark_protection_requested(conn, permit):
    """Call in the transaction persisting possible submission, never at intent time."""
    if permit.maintenance_receipt_hash is not None:
        await require_maintenance_attempt(conn, permit)
        return
    params, row = await _bound_request(conn, permit)
    if row["resolution_hash"] is not None:
        raise FinanceError("Resolved protection cannot submit a new reduction")
    if row["status"] == "requested":
        return
    if row["status"] != "intended":
        raise FinanceError("Protection cannot submit after its recorded disposition")
    await conn.execute(text("""
        UPDATE simulation_protections SET status='requested',requested_at=:cursor,
          reason='immediate_reduction_submission_possible',updated_at=clock_timestamp()
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND protection_order_id=:protection
    """), {**params, "cursor": permit.issued_at_cursor})


async def apply_protection_event(conn, event, permit):
    """Acceptance is source acknowledgement only; no hold release or flat claim."""
    if event.kind not in {"protection_accepted", "protection_rejected"} or \
            event.scope != permit.scope or event.run_id != permit.run_id or \
            event.run_manifest_hash != permit.run_manifest_hash or event.permit_hash != permit.permit_hash or \
            event.order_id != permit.order_id or event.protection_order_id != permit.order_id or \
            event.instrument_version_id != permit.instrument_version_id or \
            event.client_id != permit.client_id or event.attempt_id != permit.attempt_id or \
            event.order_ordinal != permit.order_ordinal:
        raise FinanceError("Protection event differs from its submitted reduction")
    await _source(conn, event)
    if permit.maintenance_receipt_hash is not None:
        await require_maintenance_attempt(conn, permit)
        # The immutable per-attempt order/fold records this outcome. The
        # originating fill obligations persist until a separate flat proof.
        return "confirmed" if event.kind == "protection_accepted" else "rejected"
    params, row = await _bound_request(conn, permit)
    confirmed = event.kind == "protection_accepted"
    state = "confirmed" if confirmed else "rejected"
    field = "confirmed_event_hash" if confirmed else "rejected_event_hash"
    if row["status"] == state and row[field] == event.event_hash:
        return state
    if row["status"] != "requested":
        raise FinanceError("Protection outcome contradicts its prior state")
    await conn.execute(text(f"""
        UPDATE simulation_protections SET status=:status,{field}=:event,
          reason=:reason,updated_at=clock_timestamp()
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
          AND protection_order_id=:protection
    """), {**params, "status": state, "event": event.event_hash,
        "reason": "immediate_reduction_accepted_exposure_pending" if confirmed else
                  "immediate_reduction_rejected_exposure_pending"})
    return state
