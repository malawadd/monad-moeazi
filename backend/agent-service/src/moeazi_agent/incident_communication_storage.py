"""Two-stage append-only persistence for the isolated communication fixture proof."""
from __future__ import annotations
import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from .incident_communication_canonical import digest
from .incident_communication_decisions import IncidentCommunicationConflict
from .test_center_storage import save_run_on_connection as _commit_run

class IncidentCommunicationRepository:
    def __init__(self, engine: AsyncEngine): self.engine=engine
    async def _put(self, conn, table: str, key: str, value, scope: str):
        payload=value.model_dump(mode="json") if hasattr(value,"model_dump") else value; token=payload[key]
        row=(await conn.execute(text(f"SELECT payload FROM {table} WHERE {key}=:key"),{"key":token})).first()
        if row and dict(row.payload)!=payload: raise RuntimeError("incident communication immutable content conflict")
        if not row: await conn.execute(text(f"INSERT INTO {table}(scope_hash,{key},payload) VALUES(:scope,:key,CAST(:payload AS jsonb))"),{"scope":scope,"key":token,"payload":json.dumps(payload,sort_keys=True)})
    async def _conflict(self, scope: str, reason: str):
        body={"scope_hash":scope,"reason":reason}; value=IncidentCommunicationConflict(**body,conflict_hash=digest(body))
        async with self.engine.begin() as conn: await self._put(conn,"incident_communication_conflicts","conflict_hash",value,scope)
        raise RuntimeError("incident communication conflict recorded")
    async def persist_bundle(self, artifacts: dict, payload: dict, *, fail_after_intent: bool=False) -> dict:
        revision=artifacts["_revision"]; scope=digest({"operator":revision.operator_test_id,"tenant":revision.tenant_fingerprint,"incident":revision.incident_id})
        async with self.engine.begin() as conn:
            claim=(await conn.execute(text("SELECT request_hash FROM incident_communication_request_claims WHERE operator_test_id=:o AND idempotency_key=:k FOR UPDATE"),{"o":revision.operator_test_id,"k":payload["idempotencyKey"]})).first()
            if claim and claim.request_hash!=payload["requestHash"]: await self._conflict(scope,"changed_request")
            await conn.execute(text("INSERT INTO incident_communication_scopes(scope_hash,operator_test_id,tenant_fingerprint,incident_id,payload) VALUES(:s,:o,:t,:i,'{}') ON CONFLICT DO NOTHING"),{"s":scope,"o":revision.operator_test_id,"t":revision.tenant_fingerprint,"i":revision.incident_id})
            for table,key,values in (("incident_communication_policies","policy_hash",[artifacts["_policy"]]),("incident_communication_revisions","revision_hash",[revision]),("incident_communication_audiences","resolution_hash",artifacts["_audiences"]),("incident_communication_messages","message_hash",artifacts["_messages"]),("incident_communication_outbox","row_hash",artifacts["_rows"]),("incident_communication_transitions","transition_hash",artifacts["_transitions"])):
                for value in values: await self._put(conn,table,key,value,scope)
            if not claim: await conn.execute(text("INSERT INTO incident_communication_request_claims(operator_test_id,idempotency_key,request_hash,scope_hash,payload) VALUES(:o,:k,:r,:s,'{}')"),{"o":revision.operator_test_id,"k":payload["idempotencyKey"],"r":payload["requestHash"],"s":scope})
        if fail_after_intent: raise RuntimeError("injected failure after durable communication intent")
        async with self.engine.begin() as conn:
            prior=(await conn.execute(text("SELECT r.payload FROM incident_communication_test_center_bundles b JOIN agent_test_center_runs r ON r.run_id=b.run_id WHERE b.scope_hash=:s AND b.decision_hash=:d"),{"s":scope,"d":artifacts["_decision"].decision_hash})).first()
            if prior: return dict(prior.payload)
            for table,key,values in (("incident_communication_deliveries","receipt_hash",artifacts["_deliveries"]),("incident_communication_acknowledgements","receipt_hash",artifacts["_acks"]),("incident_communication_decisions","decision_hash",[artifacts["_decision"]])):
                for value in values: await self._put(conn,table,key,value,scope)
            run=await _commit_run(conn,payload)
            await conn.execute(text("INSERT INTO incident_communication_test_center_bundles(run_id,scope_hash,decision_hash) VALUES(:r,:s,:d)"),{"r":run["runId"],"s":scope,"d":artifacts["_decision"].decision_hash})
            return run
