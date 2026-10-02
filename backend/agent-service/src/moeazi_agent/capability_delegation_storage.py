"""One-transaction immutable persistence for local Feature 08 bundles."""
from __future__ import annotations

import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .capability_delegation_contracts import (CapabilityDecision, CapabilityInputManifest,
    CapabilityObservation, GrantLifecycleTransition, GrantSpec)
from .test_center_storage import save_run_on_connection


def _same_payload(stored, value: dict) -> bool:
    return (json.loads(stored) if isinstance(stored, str) else stored) == value


async def _verify_payload(conn, table: str, key: str, value: str, payload: dict) -> None:
    """All table names are local constants; read back every idempotent append."""
    prior = (await conn.execute(text(f"SELECT payload FROM {table} WHERE {key}=:value"), {"value": value})).first()
    if not prior or not _same_payload(prior.payload, payload):
        raise RuntimeError(f"capability {table} append conflict")


class CapabilityDelegationRepository:
    def __init__(self, engine: AsyncEngine): self.engine = engine

    async def persist_bundle(self, grants: list[GrantSpec], observations: list[CapabilityObservation],
                             transitions: list[GrantLifecycleTransition], manifest: CapabilityInputManifest,
                             decision: CapabilityDecision, run_payload: dict) -> dict:
        if decision.input_manifest_hash != manifest.manifest_hash or decision.request_hash != manifest.request_hash:
            raise RuntimeError("capability manifest does not bind decision")
        async with self.engine.begin() as conn:
            scope = manifest.scope
            for grant in grants:
                grant_payload = grant.model_dump(mode="json")
                await conn.execute(text("""INSERT INTO capability_grant_specs (grant_hash,tenant_id,account_id,scope_key,grant_id,grant_type,payload)
                    VALUES (:hash,:tenant,:account,:scope,:id,:type,CAST(:payload AS jsonb)) ON CONFLICT DO NOTHING"""),
                    {"hash": grant.grant_hash, "tenant": scope.tenant_id, "account": scope.account_id, "scope": scope.scope_key,
                     "id": grant.grant_id, "type": grant.grant_type, "payload": json.dumps(grant_payload, sort_keys=True)})
                await _verify_payload(conn, "capability_grant_specs", "grant_hash", grant.grant_hash, grant_payload)
            for observation in observations:
                observation_payload = observation.model_dump(mode="json")
                await conn.execute(text("""INSERT INTO capability_state_observations (observation_hash,grant_hash,tenant_id,account_id,scope_key,state,expires_at,payload)
                    VALUES (:hash,:grant,:tenant,:account,:scope,:state,:expires,CAST(:payload AS jsonb)) ON CONFLICT DO NOTHING"""),
                    {"hash": observation.observation_hash, "grant": observation.grant_hash, "tenant": scope.tenant_id, "account": scope.account_id,
                     "scope": scope.scope_key, "state": observation.state, "expires": observation.expires_at,
                     "payload": json.dumps(observation_payload, sort_keys=True)})
                await _verify_payload(conn, "capability_state_observations", "observation_hash", observation.observation_hash, observation_payload)
            manifest_payload = manifest.model_dump(mode="json")
            await conn.execute(text("""INSERT INTO capability_input_manifests (manifest_hash,tenant_id,account_id,scope_key,operation,request_hash,idempotency_key,payload)
                VALUES (:hash,:tenant,:account,:scope,:operation,:request,:key,CAST(:payload AS jsonb)) ON CONFLICT DO NOTHING"""),
                {"hash": manifest.manifest_hash, "tenant": scope.tenant_id, "account": scope.account_id, "scope": scope.scope_key,
                 "operation": manifest.operation, "request": manifest.request_hash, "key": manifest.idempotency_key,
                 "payload": json.dumps(manifest_payload, sort_keys=True)})
            await _verify_payload(conn, "capability_input_manifests", "manifest_hash", manifest.manifest_hash, manifest_payload)
            for transition in transitions:
                transition_payload = transition.model_dump(mode="json")
                await conn.execute(text("""INSERT INTO capability_lifecycle_transitions (transition_hash,grant_hash,sequence,predecessor_hash,payload)
                    VALUES (:hash,:grant,:sequence,:predecessor,CAST(:payload AS jsonb)) ON CONFLICT DO NOTHING"""),
                    {"hash": transition.transition_hash, "grant": transition.grant_hash, "sequence": transition.sequence,
                     "predecessor": transition.predecessor_hash, "payload": json.dumps(transition_payload, sort_keys=True)})
                await _verify_payload(conn, "capability_lifecycle_transitions", "transition_hash", transition.transition_hash, transition_payload)
            inserted = (await conn.execute(text("""INSERT INTO capability_decisions (decision_hash,tenant_id,account_id,scope_key,operation,outcome,manifest_hash,request_hash,idempotency_key,expires_at,payload)
                VALUES (:hash,:tenant,:account,:scope,:operation,:outcome,:manifest,:request,:key,:expires,CAST(:payload AS jsonb))
                ON CONFLICT (tenant_id,account_id,scope_key,idempotency_key) DO NOTHING RETURNING decision_hash"""),
                {"hash": decision.decision_hash, "tenant": scope.tenant_id, "account": scope.account_id, "scope": scope.scope_key,
                 "operation": manifest.operation, "outcome": decision.outcome, "manifest": manifest.manifest_hash,
                 "request": decision.request_hash, "key": decision.idempotency_key, "expires": decision.expires_at,
                 "payload": json.dumps(decision.model_dump(mode="json"), sort_keys=True)})).first()
            if not inserted:
                prior = (await conn.execute(text("""SELECT decision_hash,request_hash FROM capability_decisions WHERE tenant_id=:tenant AND account_id=:account AND scope_key=:scope AND idempotency_key=:key"""),
                    {"tenant": scope.tenant_id, "account": scope.account_id, "scope": scope.scope_key, "key": decision.idempotency_key})).first()
                if not prior or prior.decision_hash != decision.decision_hash or prior.request_hash != decision.request_hash:
                    raise RuntimeError("capability decision idempotency conflict")
            await _verify_payload(conn, "capability_decisions", "decision_hash", decision.decision_hash, decision.model_dump(mode="json"))
            run = await save_run_on_connection(conn, run_payload)
            await conn.execute(text("""INSERT INTO capability_test_center_bundles (run_id,manifest_hash,decision_hash,lifecycle_head_hash)
                VALUES (:run,:manifest,:decision,:head) ON CONFLICT DO NOTHING"""),
                {"run": run["runId"], "manifest": manifest.manifest_hash, "decision": decision.decision_hash,
                 "head": manifest.lifecycle_head_hash})
            bound = (await conn.execute(text("SELECT manifest_hash,decision_hash,lifecycle_head_hash FROM capability_test_center_bundles WHERE run_id=:run"),
                {"run": run["runId"]})).first()
            if not bound or tuple(bound) != (manifest.manifest_hash, decision.decision_hash, manifest.lifecycle_head_hash):
                raise RuntimeError("capability Test Center bundle conflict")
            return run
