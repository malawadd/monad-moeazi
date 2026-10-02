"""Source-backed resolution of a flat instrument, without erasing protection history."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest
from .lifecycle_flat_resolution_inputs import flat_resolution_inputs
from .lifecycle_phase_receipts import PhaseCommand, load_phase_receipt, store_phase_receipt
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params


class LifecycleFlatResolutionMixin:
    async def resolve_flat_positions(self, scope: FinanceScope, run_id: str,
                                     manifest_hash: str, *, worker_id: str,
                                     command_id: str, phase_command: PhaseCommand | None = None) -> dict:
        if scope.environment != "experiment" or not worker_id or not command_id:
            raise FinanceError("flat resolution requires a scoped experimental writer")
        phase_command = phase_command or PhaseCommand(scope, run_id, manifest_hash,
            command_id, "resolution", {})
        phase_command.bind(scope, run_id, manifest_hash, "resolution")
        epoch = await self.finance.acquire_writer_epoch(scope, worker_id)
        params = _run_params(scope, run_id)
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            await self.finance._writer(conn, account, epoch)
            if run["manifest_hash"] != manifest_hash:
                raise FinanceError("flat resolution manifest differs")
            prior = await load_phase_receipt(conn, phase_command)
            if prior is not None:
                return prior
            manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
            candidates = (await conn.execute(text("""
                SELECT DISTINCT p.instrument_version_id FROM simulation_positions p
                WHERE p.environment=:environment AND p.scope_id=:scope_id
                  AND p.strategy_account_id=:strategy_account_id AND p.run_id=:run_id
                  AND p.signed_exposure_units=0 AND p.collateral_units=0
                  AND (p.pending_obligations OR EXISTS(SELECT 1 FROM simulation_protections q
                    WHERE q.environment=p.environment AND q.scope_id=p.scope_id
                      AND q.strategy_account_id=p.strategy_account_id AND q.run_id=p.run_id
                      AND q.instrument_version_id=p.instrument_version_id AND q.resolution_hash IS NULL))
                ORDER BY p.instrument_version_id
            """), params)).scalars().all()
            for instrument in candidates:
                inventory = await flat_resolution_inputs(conn, scope, manifest, run, account, instrument)
                if inventory is None:
                    continue
                body = {"scope": scope.model_dump(mode="json"), "runId": run_id,
                    "instrumentVersionId": instrument, "commandId": command_id,
                    "manifestHash": manifest_hash, "accountRevision": account["revision"],
                    "accountSnapshotHash": account["observation_snapshot_hash"],
                    "replayCursorAt": run["replay_cursor_at"].isoformat(), **inventory}
                proof_hash = _digest("moeazi-simulation-flat-resolution-v1", body)
                body["resolutionHash"] = proof_hash
                await conn.execute(text("""
                    INSERT INTO simulation_flat_resolutions(environment,scope_id,strategy_account_id,
                      run_id,instrument_version_id,command_id,manifest_hash,resolution_hash,
                      account_revision,account_snapshot_hash,replay_cursor_at,source_root,journal_root,
                      position_root,proof_json)
                    VALUES(:environment,:scope_id,:strategy_account_id,:run_id,:instrument,:command,
                      :manifest,:proof,:revision,:snapshot,:cursor,:source,:journal,:position,CAST(:body AS jsonb))
                """), {**params, "instrument": instrument, "command": command_id,
                    "manifest": manifest_hash, "proof": proof_hash, "revision": account["revision"],
                    "snapshot": account["observation_snapshot_hash"], "cursor": run["replay_cursor_at"],
                    "source": inventory["sourceRoot"], "journal": inventory["journalRoot"],
                    "position": inventory["positionRoot"],
                    "body": json.dumps(body, sort_keys=True, separators=(",", ":"))})
                # Keep original acceptance/rejection and fill-origin evidence intact.
                await conn.execute(text("""
                    UPDATE simulation_protections SET resolution_hash=:proof,updated_at=clock_timestamp()
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                      AND instrument_version_id=:instrument AND resolution_hash IS NULL
                """), {**params, "instrument": instrument, "proof": proof_hash})
                await conn.execute(text("""
                    UPDATE simulation_positions SET pending_obligations=false,
                      reason='flat_source_resolved',updated_at=clock_timestamp()
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                      AND instrument_version_id=:instrument
                """), {**params, "instrument": instrument})
                await conn.execute(text("""
                    UPDATE simulation_runs SET projection_revision=projection_revision+1,
                      updated_at=clock_timestamp() WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                """), params)
                return await store_phase_receipt(conn, phase_command, {"resolved": True,
                    "resolutionHash": proof_hash, "instrumentVersionId": instrument,
                    "resolvedObligations": len(inventory["obligationIntendedHashes"]),
                    "projectionRevision": run["projection_revision"] + 1})
            return await store_phase_receipt(conn, phase_command, {"resolved": False,
                "reason": "no_reconciled_flat_instrument", "projectionRevision": run["projection_revision"]})
