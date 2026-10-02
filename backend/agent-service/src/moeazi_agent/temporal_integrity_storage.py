"""Immutable local fixture persistence for temporal decisions and frozen input bundles."""
from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .temporal_integrity_contracts import NonceLease, TemporalInputManifest, TemporalSafetyDecision
from .test_center_storage import save_run_on_connection


def _same_payload(stored, value: dict) -> bool:
    """Verify an idempotent JSONB readback rather than silently accepting it."""
    return (json.loads(stored) if isinstance(stored, str) else stored) == value


class TemporalIntegrityRepository:
    def __init__(self, engine: AsyncEngine): self.engine = engine

    async def persist(self, decision: TemporalSafetyDecision, lease: NonceLease | None = None) -> None:
        async with self.engine.begin() as conn:
            await self._persist_on_connection(conn, decision, lease)

    async def persist_bundle(self, decision: TemporalSafetyDecision, manifest: TemporalInputManifest,
                             run_payload: dict) -> dict:
        if manifest.manifest_hash != decision.input_manifest_hash or manifest.request_hash != decision.request_hash:
            raise RuntimeError("Temporal frozen input manifest does not bind decision")
        async with self.engine.begin() as conn:
            manifest_payload = manifest.model_dump(mode="json")
            inserted_manifest = (await conn.execute(text("""INSERT INTO temporal_input_manifests
                (manifest_hash,scope_key,operation,registry_hash,inventory_hash,scenario_hash,request_hash,idempotency_key,payload)
                VALUES (:hash,:scope,:operation,:registry,:inventory,:scenario,:request,:key,CAST(:payload AS jsonb))
                ON CONFLICT (manifest_hash) DO NOTHING RETURNING manifest_hash"""),
                {"hash": manifest.manifest_hash, "scope": manifest.scope.key, "operation": manifest.operation,
                 "registry": manifest.registry_hash, "inventory": manifest.inventory_hash,
                 "scenario": manifest.scenario_hash, "request": manifest.request_hash,
                 "key": manifest.idempotency_key,
                 "payload": json.dumps(manifest_payload, sort_keys=True)})).first()
            if not inserted_manifest:
                prior = (await conn.execute(text("SELECT payload FROM temporal_input_manifests WHERE manifest_hash=:hash"),
                    {"hash": manifest.manifest_hash})).first()
                if not prior or not _same_payload(prior.payload, manifest_payload):
                    raise RuntimeError("Temporal input manifest conflict")
            await self._persist_on_connection(conn, decision, manifest.nonce)
            run = await save_run_on_connection(conn, run_payload)
            bound = (await conn.execute(text("""INSERT INTO temporal_test_center_bundles
                (run_id,decision_hash,manifest_hash) VALUES (:run,:decision,:manifest)
                ON CONFLICT (run_id) DO NOTHING RETURNING run_id"""),
                {"run": run["runId"], "decision": decision.decision_hash, "manifest": manifest.manifest_hash})).first()
            if not bound:
                prior = (await conn.execute(text("SELECT decision_hash,manifest_hash FROM temporal_test_center_bundles WHERE run_id=:run"),
                    {"run": run["runId"]})).first()
                if not prior or tuple(prior) != (decision.decision_hash, manifest.manifest_hash):
                    raise RuntimeError("Temporal Test Center bundle conflict")
            return run

    async def _persist_on_connection(self, conn, decision: TemporalSafetyDecision,
                                     lease: NonceLease | None) -> None:
        if lease:
            lease_payload = json.dumps(lease.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
            inserted_lease = (await conn.execute(text("""INSERT INTO temporal_nonce_leases
                (domain_id,nonce,lease_hash,signer_fingerprint,account_key,request_hash,idempotency_key,state,payload)
                VALUES (:domain,:nonce,:hash,:signer,:account,:request,:key,:state,CAST(:payload AS jsonb))
                ON CONFLICT (domain_id,idempotency_key) DO NOTHING RETURNING lease_hash"""),
                {"domain": lease.domain_id, "nonce": lease.nonce, "hash": lease.lease_hash,
                 "signer": lease.signer_fingerprint, "account": lease.acted_for_account,
                 "request": lease.request_hash, "key": lease.idempotency_key, "state": lease.state,
                 "payload": lease_payload})).first()
            if not inserted_lease:
                prior = (await conn.execute(text("""SELECT lease_hash,payload FROM temporal_nonce_leases
                    WHERE domain_id=:domain AND idempotency_key=:key"""),
                    {"domain": lease.domain_id, "key": lease.idempotency_key})).first()
                if not prior or prior.lease_hash != lease.lease_hash or not _same_payload(
                        prior.payload, lease.model_dump(mode="json")):
                    raise RuntimeError("Temporal nonce lease idempotency conflict")
        payload = json.dumps(decision.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        inserted = (await conn.execute(text("""INSERT INTO temporal_safety_decisions
            (decision_hash,scope_key,operation,outcome,registry_hash,inventory_hash,input_manifest_hash,
             request_hash,idempotency_key,expires_at,payload)
            VALUES (:hash,:scope,:operation,:outcome,:registry,:inventory,:input,:request,:key,:expires,CAST(:payload AS jsonb))
            ON CONFLICT (scope_key,idempotency_key) DO NOTHING RETURNING decision_hash"""),
            {"hash": decision.decision_hash, "scope": decision.scope.key, "operation": decision.operation,
             "outcome": decision.outcome, "registry": decision.registry_hash,
             "inventory": decision.inventory_hash, "input": decision.input_manifest_hash,
             "request": decision.request_hash, "key": decision.idempotency_key,
             "expires": decision.expires_at, "payload": payload})).first()
        if not inserted:
            prior = (await conn.execute(text("""SELECT decision_hash,request_hash FROM temporal_safety_decisions
                WHERE scope_key=:scope AND idempotency_key=:key"""),
                {"scope": decision.scope.key, "key": decision.idempotency_key})).first()
            if not prior or prior.decision_hash != decision.decision_hash or prior.request_hash != decision.request_hash:
                raise RuntimeError("Temporal decision idempotency conflict")
