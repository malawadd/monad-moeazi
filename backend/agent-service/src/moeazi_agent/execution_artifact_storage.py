"""Tenant-scoped immutable Timescale writes for fixture certification records."""
from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .execution_artifact_contracts import CertificationDecision, CertificationInputManifest, DriftEvent, digest
from .test_center_storage import save_run_on_connection


def _same_payload(stored, value: dict) -> bool:
    return (json.loads(stored) if isinstance(stored, str) else stored) == value


class ExecutionArtifactRepository:
    def __init__(self, engine: AsyncEngine): self.engine = engine

    async def persist(self, decision: CertificationDecision, drifts: list[DriftEvent] = []) -> CertificationDecision:
        payload = json.dumps(decision.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        async with self.engine.begin() as conn:
            return await self._persist_on_connection(conn, decision, payload, drifts)

    async def persist_bundle(self, decision: CertificationDecision, manifest: CertificationInputManifest,
                             run_payload: dict, drifts: list[DriftEvent] = []) -> dict:
        if manifest.manifest_hash != decision.input_manifest_hash or manifest.request_hash != decision.request_hash:
            raise RuntimeError("Artifact frozen input manifest does not bind decision")
        payload = json.dumps(decision.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        async with self.engine.begin() as conn:
            manifest_payload = manifest.model_dump(mode="json")
            inserted_manifest = (await conn.execute(text("""INSERT INTO execution_artifact_input_manifests
                (manifest_hash,scope_key,operation,request_hash,idempotency_key,payload)
                VALUES (:hash,:scope,:operation,:request,:key,CAST(:payload AS jsonb))
                ON CONFLICT (manifest_hash) DO NOTHING RETURNING manifest_hash"""),
                {"hash": manifest.manifest_hash, "scope": manifest.account_scope.key,
                 "operation": manifest.operation, "request": manifest.request_hash,
                 "key": manifest.idempotency_key,
                 "payload": json.dumps(manifest_payload, sort_keys=True)})).first()
            if not inserted_manifest:
                prior = (await conn.execute(text("SELECT payload FROM execution_artifact_input_manifests WHERE manifest_hash=:hash"),
                    {"hash": manifest.manifest_hash})).first()
                if not prior or not _same_payload(prior.payload, manifest_payload):
                    raise RuntimeError("Artifact input manifest conflict")
            await self._persist_on_connection(conn, decision, payload, drifts)
            run = await save_run_on_connection(conn, run_payload)
            bound = (await conn.execute(text("""INSERT INTO execution_artifact_test_center_bundles
                (run_id,decision_hash,manifest_hash) VALUES (:run,:decision,:manifest)
                ON CONFLICT (run_id) DO NOTHING RETURNING run_id"""),
                {"run": run["runId"], "decision": decision.decision_hash, "manifest": manifest.manifest_hash})).first()
            if not bound:
                prior = (await conn.execute(text("SELECT decision_hash,manifest_hash FROM execution_artifact_test_center_bundles WHERE run_id=:run"),
                    {"run": run["runId"]})).first()
                if not prior or tuple(prior) != (decision.decision_hash, manifest.manifest_hash):
                    raise RuntimeError("Artifact Test Center bundle conflict")
            return run

    async def _persist_on_connection(self, conn, decision: CertificationDecision, payload: str,
                                     drifts: list[DriftEvent]) -> CertificationDecision:
        scope = decision.account_scope.key
        graph = (await conn.execute(text("""INSERT INTO execution_artifact_graph_snapshots
            (graph_hash,scope_key,operation,input_manifest_hash,payload)
            VALUES (:graph,:scope,:operation,:input,CAST(:payload AS jsonb))
            ON CONFLICT (graph_hash) DO NOTHING RETURNING graph_hash"""),
            {"graph": decision.graph_hash, "scope": scope, "operation": decision.operation,
             "input": decision.input_manifest_hash, "payload": payload})).first()
        if not graph:
            prior = (await conn.execute(text("""SELECT scope_key,operation,input_manifest_hash,payload
                FROM execution_artifact_graph_snapshots WHERE graph_hash=:graph"""), {"graph": decision.graph_hash})).first()
            expected = decision.model_dump(mode="json")
            if not prior or tuple(prior)[:3] != (scope, decision.operation, decision.input_manifest_hash) \
                    or not _same_payload(prior.payload, expected):
                raise RuntimeError("Artifact graph snapshot conflict")
        inserted = (await conn.execute(text("""INSERT INTO execution_artifact_decisions
            (decision_hash,scope_key,operation,outcome,graph_hash,spec_manifest_hash,observation_manifest_hash,
             input_manifest_hash,request_hash,idempotency_key,evaluated_at,expires_at,payload)
            VALUES (:hash,:scope,:operation,:outcome,:graph,:specs,:observations,:input,:request,:key,:at,:expires,CAST(:payload AS jsonb))
            ON CONFLICT (scope_key,idempotency_key) DO NOTHING RETURNING decision_hash"""),
            {"hash": decision.decision_hash, "scope": scope, "operation": decision.operation,
             "outcome": decision.outcome, "graph": decision.graph_hash, "specs": decision.spec_manifest_hash,
             "observations": decision.observation_manifest_hash, "input": decision.input_manifest_hash,
             "request": decision.request_hash, "key": decision.idempotency_key,
             "at": decision.evaluated_at, "expires": decision.expires_at, "payload": payload})).first()
        if not inserted:
            prior = (await conn.execute(text("""SELECT decision_hash,request_hash,payload FROM execution_artifact_decisions
                WHERE scope_key=:scope AND idempotency_key=:key"""),
                {"scope": scope, "key": decision.idempotency_key})).first()
            if not prior or prior.decision_hash != decision.decision_hash or prior.request_hash != decision.request_hash:
                raise RuntimeError("Artifact decision idempotency conflict")
            if not _same_payload(prior.payload, decision.model_dump(mode="json")):
                raise RuntimeError("Artifact decision payload conflict")
            return CertificationDecision.model_validate(prior.payload)
        for drift in drifts:
            drift_payload = json.dumps(drift.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
            await conn.execute(text("""INSERT INTO execution_artifact_drifts
                (drift_hash,scope_key,artifact_id,drift_class,current_observation_hash,invalidation_set_hash,payload)
                VALUES (:hash,:scope,:artifact,:class,:current,:invalidations,CAST(:payload AS jsonb)) ON CONFLICT DO NOTHING"""),
                {"hash": drift.drift_hash, "scope": drift.scope.key, "artifact": drift.artifact_id,
                 "class": drift.drift_class, "current": drift.current_observation_hash,
                 "invalidations": drift.invalidation_set_hash, "payload": drift_payload})
            for kind in drift.affected_dependants:
                receipt = digest({"drift": drift.drift_hash, "kind": kind, "decision": decision.decision_hash})
                await conn.execute(text("""INSERT INTO execution_artifact_invalidations
                    (receipt_hash,drift_hash,dependent_kind,dependent_id,predecessor_hash,state,payload)
                    VALUES (:receipt,:drift,:kind,:id,:predecessor,'invalidated',CAST(:payload AS jsonb)) ON CONFLICT DO NOTHING"""),
                    {"receipt": receipt, "drift": drift.drift_hash, "kind": kind, "id": "fixture",
                     "predecessor": decision.decision_hash,
                     "payload": json.dumps({"kind": kind, "state": "invalidated"})})
        return decision

    async def approved_requalification(self, scope_key: str, drift_hash: str) -> bool:
        async with self.engine.connect() as conn:
            return bool((await conn.execute(text("""SELECT 1 FROM execution_artifact_requalifications
                WHERE scope_key=:scope AND drift_hash=:drift AND outcome='approve' LIMIT 1"""),
                {"scope": scope_key, "drift": drift_hash})).first())
