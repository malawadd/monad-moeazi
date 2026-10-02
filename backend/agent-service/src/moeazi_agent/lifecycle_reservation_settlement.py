"""Proof-backed disposition of a terminal simulated order's financial hold."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_capacity import held_excess
from .finance_contracts import FinanceError, FinanceScope, _digest, _hash, db_native_int
from .lifecycle_checkpoint_verify import verify_replay_checkpoint
from .lifecycle_phase_receipts import PhaseCommand, load_phase_receipt, store_phase_receipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params


def _proof(scope, run_id, manifest_hash, command_id, order, oracle, snapshot,
           cursor, before, after):
    cumulative = db_native_int(order["cumulative_filled_units"])
    body = {"scope": scope.model_dump(mode="json"), "runId": run_id,
            "manifestHash": manifest_hash, "commandId": command_id,
            "reservationId": order["reservation_id"], "orderId": order["order_id"],
            "permitHash": order["permit_hash"],
            "calculationReceiptHash": order["calculation_receipt_hash"],
            "terminalEventHash": order["terminal_event_hash"],
            "terminalOrderStatus": order["status"],
            "cumulativeFilledUnits": str(cumulative),
            "disposition": "released" if cumulative == 0 else "settled",
            "sourceRoot": oracle.source_root, "journalRoot": oracle.journal_root,
            "positionRoot": oracle.position_root,
            "accountSnapshotHash": snapshot, "replayCursorAt": cursor.isoformat(),
            "accountRevisionBefore": before, "accountRevisionAfter": after}
    body["resolutionHash"] = _digest("moeazi-simulation-reservation-resolution-v1", body)
    return body


def funding_pending(manifest: SimulationRunManifest, order_ordinal: int,
                    replay_cursor_at) -> bool:
    """An order hold cannot retire ahead of its frozen later payment facts."""
    return any(rule.order_ordinal == order_ordinal and
               rule.at_cursor > replay_cursor_at
               for rule in manifest.scenario.funding_rules)


class LifecycleReservationSettlementMixin:
    async def settle_replay_reservations(self, scope: FinanceScope, run_id: str,
                                         manifest_hash: str, *, worker_id: str,
                                         command_id: str,
                                         phase_command: PhaseCommand | None = None) -> dict:
        """Settle at most one terminal hold; retry returns the exact prior response."""
        _hash(manifest_hash)
        if scope.environment != "experiment" or not worker_id or not command_id:
            raise FinanceError("simulation settlement requires a scoped worker command")
        if phase_command is None:
            phase_command = PhaseCommand(scope, run_id, manifest_hash, command_id,
                                         "settlement", {})
        epoch = await self.finance.acquire_writer_epoch(scope, worker_id)
        params = _run_params(scope, run_id)
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            if run["manifest_hash"] != manifest_hash:
                raise FinanceError("settlement manifest differs")
            phase_command.bind(scope, run_id, manifest_hash, "settlement")
            prior = await load_phase_receipt(conn, phase_command)
            if prior is not None:
                return prior
            await self.finance._writer(conn, account, epoch)
            manifest = SimulationRunManifest.model_validate_json(
                json.dumps(run["manifest_json"]))
            if manifest.manifest_hash != manifest_hash:
                raise FinanceError("stored settlement manifest differs")
            candidates = (await conn.execute(text("""
                SELECT o.order_id,o.order_ordinal,o.permit_hash,o.reservation_id,
                  o.terminal_event_hash,o.status,o.cumulative_filled_units,
                  o.quantity_units,r.status AS hold_status,r.calculation_receipt_hash,
                  r.resolution_proof_hash
                FROM simulation_orders o JOIN finance_reservations r ON
                  r.environment=o.environment AND r.scope_id=o.scope_id AND
                  r.strategy_account_id=o.strategy_account_id AND
                  r.reservation_id=o.reservation_id
                LEFT JOIN simulation_reservation_resolutions z ON
                  z.environment=o.environment AND z.scope_id=o.scope_id AND
                  z.strategy_account_id=o.strategy_account_id AND
                  z.reservation_id=o.reservation_id
                WHERE o.environment=:environment AND o.scope_id=:scope_id
                  AND o.strategy_account_id=:strategy_account_id AND o.run_id=:run_id
                  AND o.status IN ('filled','cancelled','rejected')
                  AND z.reservation_id IS NULL
                ORDER BY o.order_ordinal
            """), params)).mappings().all()
            if not candidates:
                result = {"status": "no_terminal_hold", "settled": False,
                          "projectionRevision": run["projection_revision"]}
                return await store_phase_receipt(conn, phase_command, result)
            order = next((row for row in candidates if not funding_pending(
                manifest, row["order_ordinal"], run["replay_cursor_at"])), None)
            if order is None:
                result = {"status": "awaiting_scheduled_funding", "settled": False,
                          "projectionRevision": run["projection_revision"]}
                return await store_phase_receipt(conn, phase_command, result)
            if order["hold_status"] not in {"submitted", "uncertain"} or \
                    order["resolution_proof_hash"] is not None or \
                    order["terminal_event_hash"] is None:
                raise FinanceError("terminal order has an unsupported hold disposition")
            pending = (await conn.execute(text("""
                SELECT 1 FROM finance_pending_events WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                LIMIT 1
            """), params)).first()
            if pending:
                raise FinanceError("unresolved financial source blocks hold settlement")
            oracle, events = await verify_replay_checkpoint(conn, scope, manifest,
                                                              run, account)
            terminal = next((event for event in events if
                event.event_hash == order["terminal_event_hash"]), None)
            if terminal is None or terminal.order_id != order["order_id"] or \
                    terminal.permit_hash != order["permit_hash"] or \
                    int(terminal.cumulative_filled_units) != \
                    db_native_int(order["cumulative_filled_units"]) or \
                    (order["status"] == "filled" and
                     (terminal.kind != "fill" or
                      db_native_int(order["cumulative_filled_units"]) !=
                      db_native_int(order["quantity_units"]))) or \
                    (order["status"] == "cancelled" and terminal.kind != "cancelled") or \
                    (order["status"] == "rejected" and
                     terminal.kind not in {"rejected", "protection_rejected"}):
                raise FinanceError("terminal order lacks exact folded source")
            snapshot = account["observation_snapshot_hash"]
            if oracle.economic_count:
                checkpoint = (await conn.execute(text("""
                    SELECT source_root,journal_root,position_root,replay_cursor_at,
                      manifest_hash FROM simulation_derived_snapshots
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                      AND snapshot_hash=:snapshot
                """), {**params, "snapshot": snapshot})).mappings().first()
                if checkpoint is None or checkpoint["source_root"] != oracle.source_root or \
                        checkpoint["journal_root"] != oracle.journal_root or \
                        checkpoint["position_root"] != oracle.position_root or \
                        checkpoint["replay_cursor_at"] != run["replay_cursor_at"] or \
                        checkpoint["manifest_hash"] != manifest_hash:
                    raise FinanceError("terminal economics lack current derived checkpoint")
            elif snapshot != manifest.account_snapshot_hash:
                raise FinanceError("zero-economic terminal differs from opening snapshot")
            current = (await conn.execute(text("""
                SELECT result,reason,observation_snapshot_hash,journal_root_hash
                FROM finance_reconciliation_checkpoints WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND account_revision=:revision
            """), {**params, "revision": account["revision"]})).mappings().first()
            if oracle.economic_count and (current is None or
                    current["observation_snapshot_hash"] != snapshot or
                    current["journal_root_hash"] != oracle.journal_root or
                    current["result"] != account["reconciliation_state"] or
                    current["reason"] != account["reconciliation_reason"]):
                raise FinanceError("terminal hold lacks a current financial checkpoint")
            if not (account["reconciliation_state"] == "clean" or
                    (account["reconciliation_state"] == "quarantined" and
                     account["reconciliation_reason"] ==
                     "reserved_capacity_exceeds_observed")):
                raise FinanceError("terminal hold has unrelated financial uncertainty")
            if not oracle.economic_count and account["reconciliation_state"] != "clean":
                raise FinanceError("zero-economic terminal lacks clean opening account")
            proof = _proof(scope, run_id, manifest_hash, command_id, order, oracle,
                           snapshot, run["replay_cursor_at"], account["revision"],
                           account["revision"] + 1)
            changed = await conn.execute(text("""
                UPDATE finance_reservations SET status=:disposition,
                  resolution_proof_hash=:proof,retention_reason=NULL,
                  updated_at=clock_timestamp()
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND
                  reservation_id=:reservation_id AND status IN ('submitted','uncertain')
                  AND resolution_proof_hash IS NULL
            """), {**params, "reservation_id": order["reservation_id"],
                   "disposition": proof["disposition"], "proof": proof["resolutionHash"]})
            if changed.rowcount != 1:
                raise FinanceError("terminal hold changed during proof")
            excess = await held_excess(conn, scope)
            state = "quarantined" if excess else "clean"
            reason = "reserved_capacity_exceeds_observed" if excess else \
                     "matched_simulated_source"
            await conn.execute(text("""
                INSERT INTO finance_reconciliation_checkpoints(environment,scope_id,
                  strategy_account_id,account_revision,observation_snapshot_hash,
                  journal_root_hash,result,reason,observed_at)
                VALUES(:environment,:scope_id,:strategy_account_id,:revision,:snapshot,
                  :root,:state,:reason,:observed_at)
            """), {**params, "revision": proof["accountRevisionAfter"],
                   "snapshot": snapshot, "root": oracle.journal_root,
                   "state": state, "reason": reason,
                   "observed_at": account["observed_at"]})
            updated = await self.finance._advance(conn, scope, epoch, account,
                reconciliation_state=state, reconciliation_reason=reason)
            await conn.execute(text("""
                INSERT INTO simulation_reservation_resolutions(environment,scope_id,
                  strategy_account_id,run_id,reservation_id,order_id,command_id,
                  manifest_hash,permit_hash,calculation_receipt_hash,
                  terminal_event_hash,terminal_order_status,cumulative_filled_units,
                  disposition,source_root,journal_root,position_root,
                  account_snapshot_hash,replay_cursor_at,account_revision_before,
                  account_revision_after,resolution_hash,resolution_json)
                VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
                  :reservation_id,:order_id,:command_id,:manifest_hash,:permit_hash,
                  :receipt,:terminal_event_hash,:terminal_status,:cumulative,
                  :disposition,:source_root,:journal_root,:position_root,:snapshot,
                  :cursor,:before,:after,:proof,CAST(:body AS jsonb))
            """), {**params, "reservation_id": order["reservation_id"],
                "order_id": order["order_id"], "command_id": command_id,
                "manifest_hash": manifest_hash, "permit_hash": order["permit_hash"],
                "receipt": order["calculation_receipt_hash"],
                "terminal_event_hash": order["terminal_event_hash"],
                "terminal_status": order["status"],
                "cumulative": proof["cumulativeFilledUnits"],
                "disposition": proof["disposition"], "source_root": oracle.source_root,
                "journal_root": oracle.journal_root, "position_root": oracle.position_root,
                "snapshot": snapshot, "cursor": run["replay_cursor_at"],
                "before": account["revision"], "after": updated["revision"],
                "proof": proof["resolutionHash"],
                "body": json.dumps(proof, sort_keys=True, separators=(",", ":"))})
            await conn.execute(text("""
                UPDATE simulation_positions SET reconciliation_state=:state,
                  reason=:reason,updated_at=clock_timestamp()
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**params, "state": state, "reason": reason})
            await conn.execute(text("""
                UPDATE simulation_runs SET projection_revision=projection_revision+1,
                  updated_at=clock_timestamp() WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id
            """), params)
            await self.finance._outbox(conn, scope, updated)
            result = {"status": state, "settled": True,
                      "reservationId": order["reservation_id"],
                      "resolutionHash": proof["resolutionHash"],
                      "accountRevision": updated["revision"],
                      "projectionRevision": run["projection_revision"] + 1}
            return await store_phase_receipt(conn, phase_command, result)
