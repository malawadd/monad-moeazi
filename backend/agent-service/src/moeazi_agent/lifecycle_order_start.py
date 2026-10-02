"""Atomic simulated submission intent and financial possible-attempt fencing."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest, _hash, db_native_int
from .lifecycle_contracts import ExecutionPermit, TradeIntent
from .lifecycle_order_approval import check_order_approval
from .lifecycle_order_decision import resolve_order_decision
from .lifecycle_order_maintenance import maintenance_for_order, verify_maintenance
from .lifecycle_order_replay_receipt import (
    check_causal_position_anchor, check_replay_start_receipt,
)
from .lifecycle_order_replay_preflight import preflight_replay_order
from .lifecycle_source_replay import preflight_simulation
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_execution_envelope import CAUSAL_MODEL_VERSION
from .lifecycle_run_store import _run_params
from .lifecycle_state import EntryAuthorizationRequest

class LifecycleOrderStartMixin:
    async def start_order(self, scope: FinanceScope, run_id: str, order_id: str,
                          *, worker_id: str, approval_receipt_hash: str | None = None
                          ) -> dict:
        """A committed result is the only authority to invoke the pure simulator."""
        if not worker_id or not order_id:
            raise FinanceError("simulation submission needs stable worker and order identity")
        if approval_receipt_hash is not None:
            _hash(approval_receipt_hash)
        params = _run_params(scope, run_id)
        async with self.finance.engine.connect() as conn:
            run = await self._run(conn, scope, run_id, lock=False)
            maintenance = await maintenance_for_order(conn, scope, run_id, order_id)
            existing = (await conn.execute(text("""
                SELECT permit_json FROM simulation_orders WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND order_id=:order_id
            """), {**params, "order_id": order_id})).mappings().first()
            if existing:
                permit = ExecutionPermit.model_validate_json(json.dumps(existing["permit_json"]))
                if permit.approval_receipt_hash != approval_receipt_hash:
                    raise FinanceError("submitted order approval identity conflicts")
                return {"permit": permit, "status": "duplicate"}
        if maintenance is None and self.entry_authorizer is None:
            raise FinanceError("new simulated submission has no product authorizer")
        manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
        from .lifecycle_simulator import (
            MODEL_HASH, MODEL_VERSION, CAUSAL_MODEL_HASH,
        )
        qualified_model = ((MODEL_VERSION, MODEL_HASH),
                           (CAUSAL_MODEL_VERSION, CAUSAL_MODEL_HASH))
        if (manifest.scenario.model_version,
                manifest.scenario.model_hash) not in qualified_model:
            raise FinanceError("unqualified simulation model cannot submit an order")
        request = EntryAuthorizationRequest(schema_version=1, scope=scope,
            run_id=run_id, manifest_hash=manifest.manifest_hash,
            created_by_subject=run["created_by_subject"],
            experiment_request_hash=run["experiment_request_hash"],
            controller_ref=manifest.controller_ref, controller_mode=manifest.controller_mode,
            registered_authority_fingerprint=run["authority_fingerprint"],
            authority_epoch=run["authority_epoch"])
        fresh = await self.entry_authorizer(request) if maintenance is None else None
        if fresh is not None and (fresh.scope != request.scope or fresh.run_id != request.run_id or \
                fresh.controller_ref != request.controller_ref or \
                fresh.controller_mode != request.controller_mode or \
                fresh.created_by_subject != request.created_by_subject or \
                fresh.experiment_request_hash != request.experiment_request_hash or \
                fresh.authority_fingerprint != request.registered_authority_fingerprint):
            raise FinanceError("submission product identity differs from persisted run")
        epoch = await self.finance.acquire_writer_epoch(scope, worker_id)
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            now = await self.finance._writer(conn, account, epoch)
            if (fresh and ((now - fresh.checked_at).total_seconds() < 0 or
                    (now - fresh.checked_at).total_seconds() > 5)) or \
                    run["manifest_hash"] != manifest.manifest_hash or \
                    (fresh and run["authority_fingerprint"] != fresh.authority_fingerprint) or \
                    (maintenance is None and (run["authority_epoch"] != account["authority_epoch"] or
                     run["entries_stopped"] or account["admission_state"] != "open")) or \
                    run["status"] == "completed_flat" or \
                    account["reconciliation_state"] != "clean" or \
                    account["policy_hash"] != manifest.policy_hash or \
                    account["policy_version"] != manifest.policy_version:
                raise FinanceError("submission authority or reconciled account changed")
            previous = (await conn.execute(text("""
                SELECT permit_json FROM simulation_orders WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND order_id=:order_id
            """), {**params, "order_id": order_id})).mappings().first()
            if previous:
                permit = ExecutionPermit.model_validate_json(json.dumps(previous["permit_json"]))
                if permit.approval_receipt_hash != approval_receipt_hash:
                    raise FinanceError("submitted order approval identity conflicts")
                return {"permit": permit, "status": "duplicate"}
            prepared = (await conn.execute(text("""
                SELECT * FROM simulation_order_preparations WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND order_id=:order_id
            """), {**params, "order_id": order_id})).mappings().first()
            if not prepared:
                raise FinanceError("simulated order has no committed preparation")
            payload = prepared["normalized_payload_json"]
            if _digest("moeazi-simulation-order-payload-v1", {
                    key: value for key, value in payload.items()
                    if key != "normalizedPayloadHash"}) != prepared["normalized_payload_hash"] or \
                    payload.get("normalizedPayloadHash") != prepared["normalized_payload_hash"] or \
                    payload.get("manifestHash") != manifest.manifest_hash or \
                    payload.get("accountSnapshotHash") != account["observation_snapshot_hash"]:
                raise FinanceError("prepared simulated payload changed")
            intent_row = (await conn.execute(text("""
                SELECT intent_json FROM simulation_intents WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND intent_id=:intent_id
            """), {**params, "intent_id": prepared["intent_id"]})).mappings().first()
            if not intent_row:
                raise FinanceError("submitted intent is missing")
            intent = TradeIntent.model_validate_json(json.dumps(intent_row["intent_json"]))
            if intent.maintenance_command_hash is not None and maintenance is None:
                raise FinanceError("maintenance intent has no exact owner close mandate")
            if intent.intent_hash != prepared["intent_hash"] or \
                    intent.calculation_receipt_hash != prepared["calculation_receipt_hash"] or \
                    intent.action == "hold" or \
                    payload.get("evidenceSnapshotHash") != intent.evidence_snapshot_hash or \
                    payload.get("decisionContextHash") != intent.decision_context_hash:
                raise FinanceError("submitted intent differs from preparation")
            context, book = await resolve_order_decision(conn, manifest, run,
                                                         account, intent)
            reservation = await self.finance._reservation(conn, scope,
                                                          prepared["reservation_id"])
            if reservation["status"] != "reserved" or reservation["expires_at"] <= now or \
                    reservation["intent_id"] != intent.intent_id or \
                    reservation["calculation_receipt_hash"] != intent.calculation_receipt_hash or \
                    reservation["authority_epoch"] != account["authority_epoch"] or \
                    (fresh and reservation["authority_fingerprint"] != fresh.authority_fingerprint) or \
                    reservation["snapshot_hash"] != account["observation_snapshot_hash"] or \
                    reservation["policy_hash"] != manifest.policy_hash or \
                    reservation["policy_version"] != manifest.policy_version or \
                    reservation["controller_ref"] != manifest.controller_ref.model_dump() or \
                    reservation["controller_mode"] != manifest.controller_mode:
                raise FinanceError("submitted order financial reservation changed")
            originating_order_id = None
            if maintenance is not None:
                current = await maintenance_for_order(conn, scope, run_id, order_id)
                if current != maintenance:
                    raise FinanceError("maintenance mandate changed before submission")
                originating_order_id = await verify_maintenance(conn, manifest,
                    run, account, intent, reservation, maintenance,
                    order_id=order_id)
            receipt_kind = (await conn.execute(text("""
                SELECT receipt_json FROM finance_calculation_receipts
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND receipt_hash=:hash
            """), {**params,
                   "hash": prepared["calculation_receipt_hash"]})).mappings().first()
            if receipt_kind is None:
                raise FinanceError("submission calculation receipt is missing")
            code = receipt_kind["receipt_json"].get("code_version")
            if code in {"replay-sizing-v1", "replay-sizing-v2"}:
                replay_receipt = await check_replay_start_receipt(conn, params,
                    prepared, payload, intent, manifest, account, run,
                    reservation, context, book)
                if (code == "replay-sizing-v2") != (
                        manifest.scenario.model_version == CAUSAL_MODEL_VERSION):
                    raise FinanceError("receipt and simulation model version differ")
                await check_causal_position_anchor(conn, params, replay_receipt)
                if maintenance is not None and (
                        code != "replay-sizing-v2" or
                        replay_receipt.request_id != "maintenance:" +
                            maintenance.command_hash or
                        replay_receipt.execution_envelope is None or
                        replay_receipt.execution_envelope.envelope_hash !=
                            maintenance.execution_envelope_hash or
                        replay_receipt.position_state_hash != maintenance.position_state_hash or
                        replay_receipt.position_revision != maintenance.position_revision or
                        replay_receipt.quantity_units != maintenance.quantity_units):
                    raise FinanceError("maintenance receipt differs from held close")
            elif code == "finance-sizing-v1" and \
                    payload.get("receiptCodeVersion") is None:
                replay_receipt = None
                if intent.action not in {"spot_buy", "spot_sell"}:
                    raise FinanceError("legacy sizing covers spot submission only")
            else:
                raise FinanceError("submission receipt kind differs from preparation")
            await check_order_approval(conn, params, manifest, run, intent,
                prepared, approval_receipt_hash, now,
                maintenance=maintenance is not None)
            evaluation_at = run["replay_cursor_at"] \
                if manifest.scenario.clock_mode == "historical_replay" else now
            age_ms = (evaluation_at - book.event_at).total_seconds() * 1000
            if book.available_at > evaluation_at or age_ms < 0 or \
                    age_ms > manifest.scenario.max_book_age_ms:
                raise FinanceError("book is stale at simulated dispatch")
            if manifest.scenario.clock_mode == "forward_shadow":
                view = await self.finance._read_state(conn, scope, account, now)
                if view["reconciliation_state"] != "clean":
                    raise FinanceError("financial observation aged before dispatch")
            permit_body = dict(schema_version=1, scope=scope,
                controller_ref=manifest.controller_ref,
                controller_mode=manifest.controller_mode, run_id=run_id,
                run_manifest_hash=manifest.manifest_hash,
                intent_id=intent.intent_id, intent_hash=intent.intent_hash,
                order_id=order_id, order_ordinal=prepared["order_ordinal"],
                client_id=prepared["client_id"], attempt_id=prepared["attempt_id"],
                reservation_id=prepared["reservation_id"],
                normalized_payload_hash=prepared["normalized_payload_hash"],
                instrument_version_id=intent.instrument_version_id,
                instrument_registry_hash=intent.instrument_registry_hash,
                action=intent.action, side=intent.side,
                quantity_kind=replay_receipt.quantity_kind if replay_receipt else
                    "asset_native",
                contract_size_unit_id=replay_receipt.contract_size_unit_id if
                    replay_receipt else None,
                contract_size_units=replay_receipt.contract_size_units if
                    replay_receipt else None,
                quantity_asset_unit_id=payload["quantityAssetUnitId"],
                quantity_registry_hash=payload["quantityRegistryHash"],
                quote_asset_unit_id=payload["quoteAssetUnitId"],
                quote_registry_hash=payload["quoteRegistryHash"],
                settlement_asset_unit_id=payload.get("settlementAssetUnitId",
                    payload["quoteAssetUnitId"]),
                settlement_registry_hash=payload.get("settlementRegistryHash",
                    payload["quoteRegistryHash"]),
                quantity_units=str(db_native_int(prepared["quantity_units"])),
                location_id=payload["locationId"], account_revision=account["revision"],
                writer_epoch=epoch, authority_epoch=account["authority_epoch"],
                policy_hash=manifest.policy_hash,
                evidence_snapshot_hash=intent.evidence_snapshot_hash,
                decision_context_hash=intent.decision_context_hash,
                approval_receipt_hash=approval_receipt_hash,
                issued_at_cursor=run["replay_cursor_at"],
                valid_until_cursor=intent.expires_at_cursor, transport="simulated",
                execution_envelope=replay_receipt.execution_envelope if
                    replay_receipt and code == "replay-sizing-v2" else None,
                protection_order_id=order_id if maintenance else None,
                originating_order_id=originating_order_id,
                maintenance_receipt_hash=maintenance.receipt_hash if
                    maintenance else None)
            digest = _digest("moeazi-execution-permit-v1", ExecutionPermit.model_construct(
                **permit_body).model_dump(mode="json", exclude={"permit_hash"}))
            permit = ExecutionPermit.model_validate(permit_body | {"permit_hash": digest})
            candidate_events = (() if code == "replay-sizing-v2" else
                await preflight_simulation(conn, manifest, permit))
            if replay_receipt is not None:
                await preflight_replay_order(self, conn, params, replay_receipt,
                    manifest, permit, candidate_events)
            await conn.execute(text("""
                INSERT INTO simulation_orders(environment,scope_id,strategy_account_id,
                  run_id,order_id,order_ordinal,intent_id,intent_hash,permit_hash,
                  permit_json,client_id,attempt_id,reservation_id,normalized_payload_hash,
                  instrument_version_id,action,side,quantity_kind,quantity_units,status)
                VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:order_id,
                  :ordinal,:intent_id,:intent_hash,:permit_hash,CAST(:permit_json AS jsonb),
                  :client_id,:attempt_id,:reservation_id,:payload_hash,:instrument,
                  :action,:side,:quantity_kind,:quantity,'submission_possible')
            """), {**params, "order_id": order_id, "ordinal": prepared["order_ordinal"],
                   "intent_id": intent.intent_id, "intent_hash": intent.intent_hash,
                   "permit_hash": permit.permit_hash,
                   "permit_json": json.dumps(permit.model_dump(mode="json"),
                                             sort_keys=True, separators=(",", ":"),
                                             ensure_ascii=False),
                   "client_id": prepared["client_id"],
                   "attempt_id": prepared["attempt_id"],
                   "reservation_id": prepared["reservation_id"],
                   "payload_hash": prepared["normalized_payload_hash"],
                   "instrument": intent.instrument_version_id,
                   "action": intent.action, "side": intent.side,
                   "quantity_kind": permit.quantity_kind,
                   "quantity": prepared["quantity_units"]})
            await conn.execute(text("""
                INSERT INTO finance_submission_attempts(environment,scope_id,
                  strategy_account_id,attempt_id,reservation_id,client_id,
                  normalized_payload_hash,status)
                VALUES(:environment,:scope_id,:strategy_account_id,:attempt_id,
                  :reservation_id,:client_id,:payload_hash,'possible')
            """), {**params, "attempt_id": prepared["attempt_id"],
                   "reservation_id": prepared["reservation_id"],
                   "client_id": prepared["client_id"],
                   "payload_hash": prepared["normalized_payload_hash"]})
            await conn.execute(text("""
                UPDATE finance_reservations SET status='submitted',
                  retention_reason='possible_simulated_submission',
                  updated_at=clock_timestamp() WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND reservation_id=:reservation_id
            """), {**params, "reservation_id": prepared["reservation_id"]})
            updated = await self.finance._advance(conn, scope, epoch, account)
            await self.finance._outbox(conn, scope, updated)
            await conn.execute(text("""
                UPDATE simulation_runs SET status='running',pending_obligations=true,
                  cursor_sequence=cursor_sequence+1,
                  projection_revision=projection_revision+1,
                  updated_at=clock_timestamp() WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id
            """), params)
            return {"permit": permit, "status": "submission_possible",
                    "accountRevision": updated["revision"]}
