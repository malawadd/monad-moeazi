"""Durable control dispatch and proof-based completion; no financial writes."""
from __future__ import annotations

import json
from datetime import timedelta

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest, _hash, db_native_int, native_int
from .lifecycle_cancel_receipts import control_hash, load_cancel_dispatches, seal_cancel_dispatch
from .lifecycle_contracts import ExecutionPermit
from .lifecycle_control_proofs import flat_instrument_proof, terminal_order_fact
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .lifecycle_phase_receipts import PhaseCommand, load_phase_receipt, store_phase_receipt
from .lifecycle_source_replay import materialize_run_events


async def _store(conn, params, body, cursor, terminal=None):
    digest = _digest("moeazi-simulation-control-processing-v1", body)
    value = {**body, "resultHash": digest}
    await conn.execute(text("""
        INSERT INTO simulation_control_processing(environment,scope_id,
          strategy_account_id,run_id,command_id,processing_kind,processed_at_cursor,
          result_hash,result_json,target_order_id,terminal_event_hash)
        VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:command,:kind,
          :cursor,:hash,CAST(:body AS jsonb),:target,:terminal)
    """), {**params, "command": body["commandId"], "kind": body["processingKind"],
        "cursor": cursor, "hash": digest,
        "body": json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False),
        "target": body.get("targetOrderId"), "terminal": terminal})


class LifecycleControlProcessingMixin:
    async def process_run_controls(self, scope: FinanceScope, run_id: str,
                                   manifest_hash: str, *, worker_id: str,
                                   phase_command: PhaseCommand | None = None) -> dict:
        """At most 128 pending controls; SQL command IDs are the retry identity.

        Cancellation can dispatch while accounting is unknown, but no control
        completes until source facts and financial settlement agree. Close-order
        creation remains the protective financial owner's responsibility.
        """
        _hash(manifest_hash)
        if scope.environment != "experiment" or not worker_id:
            raise FinanceError("Control processing requires an experimental writer")
        epoch = await self.finance.acquire_writer_epoch(scope, worker_id)
        params = _run_params(scope, run_id)
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            await self.finance._writer(conn, account, epoch)
            manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
            if run["manifest_hash"] != manifest_hash or manifest.manifest_hash != manifest_hash:
                raise FinanceError("Control processing manifest differs")
            if phase_command is not None:
                phase_command.bind(scope, run_id, manifest_hash, "controls")
                previous = await load_phase_receipt(conn, phase_command)
                if previous is not None:
                    return previous
            params["cursor"] = run["replay_cursor_at"]
            params["manifest_hash"] = manifest_hash
            # The source may already be terminal even when its financial fold
            # has not committed yet. Never dispatch a cancellation into its past.
            due_facts = await materialize_run_events(conn, manifest)
            dispatches = {item.targetOrderId: item for item in
                          await load_cancel_dispatches(conn, manifest)}
            commands = (await conn.execute(text("""
                SELECT c.* FROM simulation_commands c WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND outcome='applied'
                  AND operation IN ('request_cancel','request_close')
                  AND NOT EXISTS(SELECT 1 FROM simulation_control_processing p
                    WHERE p.environment=c.environment AND p.scope_id=c.scope_id
                      AND p.strategy_account_id=c.strategy_account_id AND p.run_id=c.run_id
                      AND p.command_id=c.command_id AND p.processing_kind='resolved')
                ORDER BY created_at,command_id LIMIT 128
            """), params)).mappings().all()
            dispatched = resolved = 0
            for command in commands:
                operation, target = command["operation"], command["target_id"]
                if command["command_hash"] != control_hash(scope, run_id, manifest_hash,
                        command["command_id"], operation, target):
                    raise FinanceError("Persisted control command identity differs")
                common = {"schemaVersion": 1, "scope": scope.model_dump(mode="json"),
                    "runId": run_id, "manifestHash": manifest_hash,
                    "commandId": command["command_id"], "commandHash": command["command_hash"],
                    "operation": operation}
                if operation == "request_close":
                    proof = (await flat_instrument_proof(conn, scope, params, target)
                             if account["reconciliation_state"] == "clean" else None)
                    if proof is not None:
                        await _store(conn, params, {**common, "processingKind": "resolved",
                            "outcome": "position_flat", "instrumentVersionId": target,
                            "accountSnapshotHash": account["observation_snapshot_hash"],
                            "resolvedCursor": run["replay_cursor_at"].isoformat(), **proof},
                            run["replay_cursor_at"])
                        resolved += 1
                    continue
                order = (await conn.execute(text("""
                    SELECT * FROM simulation_orders WHERE environment=:environment
                      AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                      AND run_id=:run_id AND order_id=:order FOR UPDATE
                """), {**params, "order": target})).mappings().one()
                terminal = (await terminal_order_fact(conn, params, order)
                            if account["reconciliation_state"] == "clean" else None)
                if terminal is not None:
                    await _store(conn, params, {**common, "processingKind": "resolved",
                        "outcome": "already_filled" if terminal.kind == "fill" else terminal.kind,
                        "targetOrderId": target, "terminalEventHash": terminal.event_hash,
                        "accountSnapshotHash": account["observation_snapshot_hash"],
                        "resolvedCursor": run["replay_cursor_at"].isoformat()},
                        run["replay_cursor_at"], terminal.event_hash)
                    resolved += 1
                    continue
                # Terminal source state awaiting finance cannot gain another
                # cancellation; repeated commands share the first durable dispatch.
                if target in dispatches or order["status"] in {"filled", "cancelled", "rejected"}:
                    continue
                if any(event.order_id == target and (event.kind in {"cancel_requested", "cancelled", "rejected"}
                        or event.kind == "fill" and native_int(event.cumulative_filled_units) ==
                            db_native_int(order["quantity_units"])) for event in due_facts):
                    continue
                permit = ExecutionPermit.model_validate_json(json.dumps(order["permit_json"]))
                if permit.scope != scope or permit.run_id != run_id or \
                        permit.run_manifest_hash != manifest_hash or \
                        permit.order_id != target or permit.permit_hash != order["permit_hash"]:
                    raise FinanceError("Cancellation target permit differs")
                requested = run["replay_cursor_at"]
                accepted = permit.issued_at_cursor + timedelta(milliseconds=manifest.scenario.latency_ms)
                receipt = seal_cancel_dispatch(**common, processingKind="dispatched",
                    outcome="requested", targetOrderId=target, permitHash=permit.permit_hash,
                    requestedCursor=requested, effectiveCursor=max(requested, accepted) +
                        timedelta(milliseconds=manifest.scenario.cancel_latency_ms))
                await _store(conn, params, receipt.model_dump(mode="json", exclude={"resultHash"}),
                             requested)
                dispatches[target] = receipt
                dispatched += 1
            if dispatched or resolved:
                await conn.execute(text("""
                    UPDATE simulation_runs SET projection_revision=projection_revision+1,
                      pending_obligations=true,updated_at=clock_timestamp()
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                """), params)
            result = {"dispatchedCount": dispatched, "resolvedCount": resolved,
                "pendingInBatch": len(commands) - resolved,
                "projectionRevision": run["projection_revision"] + bool(dispatched or resolved)}
            return await store_phase_receipt(conn, phase_command, result) \
                if phase_command is not None else result
