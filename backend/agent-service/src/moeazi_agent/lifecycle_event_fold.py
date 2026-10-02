"""Atomic source-event, financial journal, order, and position fold."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _hash, db_native_int, native_int
from .finance_policy import SizingPolicy
from .lifecycle_contracts import ExecutionPermit, TradeIntent
from .lifecycle_event_economics import build_event_economics
from .lifecycle_position_store import load_position_state, write_position_effect
from .lifecycle_protection_processing import (
    apply_protection_event, ensure_intended_protection,
)
from .lifecycle_phase_receipts import PhaseCommand, load_phase_receipt, store_phase_receipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .lifecycle_source_replay import materialize_run_events
from .observation_contracts import InstrumentVersion


async def _instrument_and_margin(conn, permit: ExecutionPermit,
                                 manifest: SimulationRunManifest
                                 ) -> tuple[InstrumentVersion, int]:
    instrument = (await conn.execute(text("""
        SELECT manifest,registry_hash FROM observation_instrument_versions
        WHERE instrument_version_id=:id
    """), {"id": permit.instrument_version_id})).mappings().first()
    policy = (await conn.execute(text("""
        SELECT policy_json FROM finance_policy_versions
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND policy_version=:version
          AND policy_hash=:hash
    """), {**_run_params(permit.scope, permit.run_id),
           "version": manifest.policy_version,
           "hash": manifest.policy_hash})).mappings().first()
    if not instrument or not policy:
        raise FinanceError("fold lacks immutable instrument or policy")
    definition = InstrumentVersion.model_validate(instrument["manifest"])
    rules = SizingPolicy.model_validate_json(json.dumps(policy["policy_json"]))
    if definition.registry_hash != instrument["registry_hash"] or \
            definition.registry_hash != permit.instrument_registry_hash or \
            rules.policy_hash != manifest.policy_hash or \
            rules.instrument_version_id != definition.instrument_version_id:
        raise FinanceError("fold instrument or policy identity differs")
    return definition, rules.initial_margin_bps


def _order_status(kind: str, cumulative: int, total: int) -> str:
    if kind == "accepted":
        return "accepted"
    if kind == "ack_lost":
        return "uncertain"
    if kind == "cancel_requested":
        return "cancel_requested"
    if kind == "cancelled":
        return "cancelled"
    if kind == "rejected":
        return "rejected"
    if kind == "fill":
        return "filled" if cumulative == total else "partially_filled"
    if kind == "funding":
        return "unchanged"
    if kind == "protection_accepted":
        return "accepted"
    if kind == "protection_rejected":
        return "rejected"
    raise FinanceError("simulated event kind has no qualified financial fold")


class LifecycleEventFoldMixin:
    async def fold_order_events(self, scope: FinanceScope, run_id: str,
                                order_id: str, *, worker_id: str,
                                command_id: str,
                                phase_command: PhaseCommand | None = None) -> dict:
        """Fold only persisted simulator facts; a failure rolls back every effect."""
        if scope.environment != "experiment" or not order_id or not worker_id or \
                not command_id:
            raise FinanceError("event fold requires a stable experimental command")
        params = _run_params(scope, run_id)
        epoch = await self.finance.acquire_writer_epoch(scope, worker_id)
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            await self.finance._writer(conn, account, epoch)
            manifest = SimulationRunManifest.model_validate_json(
                json.dumps(run["manifest_json"]))
            if run["manifest_hash"] != manifest.manifest_hash:
                raise FinanceError("fold manifest differs from registered run")
            if phase_command is not None:
                phase_command.bind(scope, run_id, manifest.manifest_hash, "fold")
                if phase_command.inputs.get("foldScope") != "all_due_run_events":
                    raise FinanceError("fold phase receipt lacks global source scope")
                prior_phase = await load_phase_receipt(conn, phase_command)
                if prior_phase is not None:
                    return prior_phase
            rows = (await conn.execute(text("""
                SELECT * FROM simulation_orders WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id ORDER BY order_ordinal FOR UPDATE
            """), params)).mappings().all()
            orders = {row["order_id"]: dict(row) for row in rows}
            if order_id not in orders:
                raise FinanceError("fold has no durable submitted order")
            permits = {key: ExecutionPermit.model_validate_json(
                json.dumps(row["permit_json"])) for key, row in orders.items()}
            if any(permit.order_id != key or permit.scope != scope or
                   permit.run_manifest_hash != manifest.manifest_hash or
                   permit.permit_hash != orders[key]["permit_hash"]
                   for key, permit in permits.items()):
                raise FinanceError("fold order permit identity differs")
            events = await materialize_run_events(conn, manifest)
            definitions = {}
            folded = 0
            for event in events:
                order = orders[event.order_id]
                permit = permits[event.order_id]
                cumulative = db_native_int(order["cumulative_filled_units"])
                total = db_native_int(order["quantity_units"])
                status = order["status"]
                prior = (await conn.execute(text("""
                    SELECT event_kind,transaction_id FROM simulation_event_folds
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                      AND event_hash=:hash
                """), {**params, "hash": event.event_hash})).mappings().first()
                if prior:
                    if prior["event_kind"] != event.kind:
                        raise FinanceError("fold receipt contradicts immutable source")
                    continue
                if event.permit_hash != permit.permit_hash or \
                        event.simulation_cursor_at > run["replay_cursor_at"]:
                    raise FinanceError("fold event is outside committed permit or cursor")
                transaction_id = None
                position_revision = None
                if event.kind in {"fill", "funding"}:
                    if permit.instrument_version_id not in definitions:
                        definitions[permit.instrument_version_id] = \
                            await _instrument_and_margin(conn, permit, manifest)
                    definition, margin_bps = definitions[permit.instrument_version_id]
                    state, previous = await load_position_state(conn, permit, definition)
                    if event.kind == "fill":
                        addition = native_int(event.fill_quantity_units or "0", positive=True)
                        if cumulative + addition != native_int(event.cumulative_filled_units) or \
                                cumulative + addition > total:
                            raise FinanceError("fill cumulative source sequence differs")
                    else:
                        addition = 0
                        if native_int(event.cumulative_filled_units) != cumulative:
                            raise FinanceError("funding changed order fill quantity")
                    effect, journal = build_event_economics(event, permit, definition,
                        state, margin_bps=margin_bps,
                        expected_revision=account["revision"], writer_epoch=epoch)
                    journaled = await self.finance.apply_journal_event_locked(
                        conn, journal, account)
                    if journaled["status"] != "applied":
                        raise FinanceError("unresolved economic source blocks atomic fold")
                    transaction_id = journaled["transactionId"]
                    position_revision = await write_position_effect(conn, permit,
                        definition, effect, previous, filled_units=addition)
                    if event.kind == "fill" and permit.action in {
                            "spot_buy", "perp_open", "perp_increase"}:
                        intent_row = (await conn.execute(text("""
                            SELECT intent_hash,intent_json FROM simulation_intents
                            WHERE environment=:environment AND scope_id=:scope_id
                              AND strategy_account_id=:strategy_account_id
                              AND run_id=:run_id AND intent_id=:intent
                        """), {**params, "intent": permit.intent_id})).mappings().first()
                        if intent_row is None:
                            raise FinanceError("increasing fill lacks persisted protection policy")
                        intent = TradeIntent.model_validate_json(
                            json.dumps(intent_row["intent_json"]))
                        if intent.intent_hash != permit.intent_hash or \
                                intent.intent_hash != intent_row["intent_hash"]:
                            raise FinanceError("increasing fill intent identity differs")
                        await ensure_intended_protection(conn, event, permit,
                            definition, effect.new_state, intent, position_revision)
                    await conn.execute(text("""
                        INSERT INTO simulation_event_journal_links(environment,scope_id,
                          strategy_account_id,run_id,event_hash,transaction_id)
                        VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
                          :hash,:transaction)
                    """), {**params, "hash": event.event_hash,
                           "transaction": transaction_id})
                    account = await self.finance._lock(conn, scope)
                    cumulative += addition
                elif event.kind in {"protection_accepted", "protection_rejected"}:
                    await apply_protection_event(conn, event, permit)
                next_status = _order_status(event.kind, cumulative, total)
                if status == "cancel_requested" and next_status in {
                        "accepted", "partially_filled"}:
                    next_status = "cancel_requested"
                if next_status != "unchanged":
                    if status in {"filled", "cancelled", "rejected"}:
                        raise FinanceError("terminal order received a contradictory fact")
                    status = next_status
                    terminal_hash = event.event_hash if status in {
                        "filled", "cancelled", "rejected"} else None
                    await conn.execute(text("""
                        UPDATE simulation_orders SET status=:status,
                          cumulative_filled_units=:cumulative,
                          terminal_event_hash=coalesce(:terminal_hash,terminal_event_hash),
                          updated_at=clock_timestamp()
                        WHERE environment=:environment AND scope_id=:scope_id
                          AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                          AND order_id=:order_id
                    """), {**params, "order_id": event.order_id,
                           "status": status, "cumulative": str(cumulative),
                           "terminal_hash": terminal_hash})
                    order["status"] = status
                    order["cumulative_filled_units"] = cumulative
                await conn.execute(text("""
                    INSERT INTO simulation_event_folds(environment,scope_id,
                      strategy_account_id,run_id,order_id,event_hash,event_kind,
                      transaction_id,position_revision,folded_at_cursor)
                    VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
                      :order_id,:hash,:kind,:transaction,:position_revision,:cursor)
                """), {**params, "order_id": event.order_id, "hash": event.event_hash,
                       "kind": event.kind, "transaction": transaction_id,
                       "position_revision": position_revision,
                       "cursor": event.simulation_cursor_at})
                folded += 1
            if folded:
                await conn.execute(text("""
                    UPDATE simulation_runs SET status='awaiting_evidence',
                      pending_obligations=true,cursor_sequence=cursor_sequence+:folded,
                      projection_revision=projection_revision+1,
                      updated_at=clock_timestamp()
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                """), {**params, "folded": folded})
            outcome = {"status": "awaiting_evidence" if folded else run["status"],
                       "foldedCount": folded,
                       "accountRevision": account["revision"],
                       "projectionRevision": run["projection_revision"] + (1 if folded else 0)}
            return await store_phase_receipt(conn, phase_command, outcome) \
                if phase_command is not None else outcome
