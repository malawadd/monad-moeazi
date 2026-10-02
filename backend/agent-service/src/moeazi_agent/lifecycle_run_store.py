"""Scoped, durable registration and read paths for experimental simulation runs."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _hash
from .finance_repository import _scope
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_state import RunAdvanceResult


def _run_params(scope: FinanceScope, run_id: str) -> dict:
    return {**_scope(scope), "run_id": run_id}


def _run_result(row: dict) -> RunAdvanceResult:
    status = row["status"]
    return RunAdvanceResult(schema_version=1, run_id=row["run_id"], status=status,
                            cursor_sequence=row["cursor_sequence"],
                            pending_obligations=row["pending_obligations"],
                            next_action="completed" if status == "completed_flat" else "await_signal",
                            projection_revision=row["projection_revision"],
                            next_wake_delay_ms=None)


class LifecycleRunStoreMixin:
    async def _run(self, conn, scope: FinanceScope, run_id: str, *, lock: bool) -> dict:
        if scope.environment != "experiment":
            raise FinanceError("simulation lifecycle cannot bind a live account")
        suffix = " FOR UPDATE" if lock else ""
        row = (await conn.execute(text("""
            SELECT * FROM simulation_runs WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
              AND run_id=:run_id
        """ + suffix), _run_params(scope, run_id))).mappings().first()
        if row is None:
            raise FinanceError("simulation run is not registered")
        return dict(row)

    async def register_run(self, manifest: SimulationRunManifest, *,
                           created_by_subject: str, experiment_request_hash: str,
                           authority_fingerprint: str, expected_revision: int,
                           idempotency_key: str) -> RunAdvanceResult:
        manifest = SimulationRunManifest.model_validate_json(manifest.model_dump_json())
        scope = manifest.scope
        _hash(experiment_request_hash)
        _hash(authority_fingerprint)
        if not created_by_subject or not idempotency_key:
            raise FinanceError("registration needs authenticated owner and stable command key")
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            prior = (await conn.execute(text("""
                SELECT * FROM simulation_runs WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND (run_id=:run_id OR registration_key=:registration_key) FOR UPDATE
            """), {**_run_params(scope, manifest.run_id),
                    "registration_key": idempotency_key})).mappings().all()
            if prior:
                if len(prior) != 1 or prior[0]["run_id"] != manifest.run_id or \
                        prior[0]["registration_key"] != idempotency_key or \
                        prior[0]["manifest_hash"] != manifest.manifest_hash or \
                        prior[0]["created_by_subject"] != created_by_subject or \
                        prior[0]["experiment_request_hash"] != experiment_request_hash or \
                        prior[0]["authority_fingerprint"] != authority_fingerprint:
                    raise FinanceError("simulation registration identity conflicts")
                return _run_result(prior[0])
            if account["revision"] != expected_revision or \
                    account["reconciliation_state"] != "clean" or \
                    account["observation_snapshot_hash"] != manifest.account_snapshot_hash or \
                    account["policy_version"] != manifest.policy_version or \
                    account["policy_hash"] != manifest.policy_hash:
                raise FinanceError("simulation manifest does not match clean account state")
            await conn.execute(text("""
                INSERT INTO simulation_runs(environment,scope_id,strategy_account_id,run_id,
                  registration_key,manifest_hash,manifest_json,scenario_hash,
                  created_by_subject,experiment_request_hash,authority_fingerprint,
                  authority_epoch,status)
                VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
                  :registration_key,:manifest_hash,CAST(:manifest_json AS jsonb),:scenario_hash,
                  :created_by_subject,:experiment_request_hash,:authority_fingerprint,
                  :authority_epoch,'registered')
            """), {**_run_params(scope, manifest.run_id),
                   "registration_key": idempotency_key, "manifest_hash": manifest.manifest_hash,
                   "manifest_json": json.dumps(manifest.model_dump(mode="json"),
                                            sort_keys=True, separators=(",", ":"), ensure_ascii=False),
                   "scenario_hash": manifest.scenario.scenario_hash,
                   "created_by_subject": created_by_subject,
                   "experiment_request_hash": experiment_request_hash,
                   "authority_fingerprint": authority_fingerprint,
                   "authority_epoch": account["authority_epoch"]})
            return RunAdvanceResult(schema_version=1, run_id=manifest.run_id,
                                    status="registered", cursor_sequence=0,
                                    pending_obligations=False, next_action="await_signal",
                                    projection_revision=0)

    async def read_run(self, scope: FinanceScope, run_id: str,
                       manifest_hash: str) -> RunAdvanceResult:
        _hash(manifest_hash)
        async with self.finance.engine.connect() as conn:
            row = await self._run(conn, scope, run_id, lock=False)
            if row["manifest_hash"] != manifest_hash:
                raise FinanceError("simulation run manifest identity changed")
            return _run_result(row)

    async def read_run_lineage(self, scope: FinanceScope, run_id: str,
                               manifest_hash: str, subject: str) -> dict:
        """Return only validated stored lineage for an owned experiment run."""
        _hash(manifest_hash)
        async with self.finance.engine.connect() as conn:
            row = await self._run(conn, scope, run_id, lock=False)
            if row["manifest_hash"] != manifest_hash or row["created_by_subject"] != subject:
                raise FinanceError("simulation run lineage owner or manifest differs")
            manifest = SimulationRunManifest.model_validate_json(json.dumps(row["manifest_json"]))
            if manifest.manifest_hash != manifest_hash or manifest.scope != scope or \
                    manifest.run_id != run_id:
                raise FinanceError("stored simulation run lineage differs")
            return {"manifestHash": manifest.manifest_hash,
                    "datasetHash": manifest.scenario.dataset_hash,
                    "scenarioHash": manifest.scenario.scenario_hash,
                    "controllerVersionId": manifest.controller_ref.controllerVersionId,
                    "controllerContentHash": manifest.controller_ref.contentHash,
                    "strategyArtifactHash": manifest.strategy_artifact_hash,
                    "clockMode": manifest.scenario.clock_mode}
