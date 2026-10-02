"""Authenticated, nonauthorizing replay rule queue for the dedicated worker."""
from __future__ import annotations

import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, _digest, _hash
from .lifecycle_dataset import load_dataset
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_run_store import _run_params
from .lifecycle_strategy import ReplayStrategyRule


class LifecycleEntryRequestMixin:
    async def queue_entry_request(self, scope: FinanceScope, run_id: str,
                                  manifest_hash: str, rule: ReplayStrategyRule,
                                  created_by_subject: str, request_id: str) -> dict:
        """Queue a frozen signal rule, never a caller-computed order or hold."""
        _hash(manifest_hash)
        rule = ReplayStrategyRule.model_validate_json(rule.model_dump_json())
        if not created_by_subject or not request_id or len(request_id) > 160:
            raise FinanceError("simulation entry request lacks stable owner identity")
        body = {"scope": scope.model_dump(mode="json"), "runId": run_id,
                "manifestHash": manifest_hash, "rule": rule.model_dump(mode="json"),
                "createdBySubject": created_by_subject, "requestId": request_id}
        digest = _digest("moeazi-simulation-entry-request-v1", body)
        params = _run_params(scope, run_id)
        async with self.finance.engine.begin() as conn:
            account = await self.finance._lock(conn, scope)
            run = await self._run(conn, scope, run_id, lock=True)
            if run["manifest_hash"] != manifest_hash or \
                    run["created_by_subject"] != created_by_subject:
                raise FinanceError("queued strategy owner or manifest differs")
            previous = (await conn.execute(text("""
                SELECT request_hash,status FROM simulation_entry_requests
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND request_id=:request_id
            """), {**params, "request_id": request_id})).mappings().first()
            if previous:
                if previous["request_hash"] != digest:
                    raise FinanceError("simulation request id conflicts with changed rule")
                return {"requestId": request_id, "status": previous["status"],
                        "projectionRevision": run["projection_revision"]}
            manifest = SimulationRunManifest.model_validate_json(json.dumps(run["manifest_json"]))
            if manifest.strategy_artifact_hash != rule.rule_hash or \
                    rule.instrument_version_id not in manifest.instrument_version_ids or \
                    run["entries_stopped"] or run["status"] == "completed_flat" or \
                    account["admission_state"] != "open":
                raise FinanceError("new strategy request is stopped or differs from run")
            # A queued request changes the run to running. Freeze and verify the
            # complete source corpus first, while the same account/run lock is held.
            await load_dataset(conn, manifest)
            sequence = (await conn.execute(text("""
                SELECT coalesce(max(request_sequence),0)+1 FROM simulation_entry_requests
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
            if sequence > 10_000:
                raise FinanceError("simulation run request limit reached")
            await conn.execute(text("""
                INSERT INTO simulation_entry_requests(environment,scope_id,
                  strategy_account_id,run_id,request_id,request_hash,manifest_hash,
                  rule_hash,rule_json,created_by_subject,status,request_sequence)
                VALUES(:environment,:scope_id,:strategy_account_id,:run_id,
                  :request_id,:request_hash,:manifest_hash,:rule_hash,
                  CAST(:rule_json AS jsonb),:subject,'queued',:sequence)
            """), {**params, "request_id": request_id, "request_hash": digest,
                   "manifest_hash": manifest_hash, "rule_hash": rule.rule_hash,
                   "rule_json": json.dumps(rule.model_dump(mode="json"),
                                           sort_keys=True, separators=(",", ":"),
                                           ensure_ascii=False),
                   "subject": created_by_subject, "sequence": sequence})
            revision = run["projection_revision"] + 1
            await conn.execute(text("""
                UPDATE simulation_runs SET status='running',
                  projection_revision=:revision,updated_at=clock_timestamp()
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**params, "revision": revision})
            return {"requestId": request_id, "status": "queued",
                    "projectionRevision": revision}
