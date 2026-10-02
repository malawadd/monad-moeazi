"""Append-only local persistence. Redis has no quorum or lease truth."""
from __future__ import annotations
import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from .safety_change_quorum_canonical import digest
from .test_center_storage import save_run_on_connection as save_run

class SafetyChangeQuorumRepository:
    def __init__(self, engine: AsyncEngine): self.engine=engine
    async def _put(self, conn, table, key, value, scope):
        payload=value.model_dump(mode="json") if hasattr(value,"model_dump") else value; token=payload[key]
        existing=(await conn.execute(text(f"SELECT payload FROM {table} WHERE {key}=:key"),{"key":token})).first()
        if existing and dict(existing.payload)!=payload: raise RuntimeError("safety change quorum immutable content conflict")
        if not existing: await conn.execute(text(f"INSERT INTO {table}(scope_hash,{key},payload) VALUES(:scope,:key,CAST(:payload AS jsonb))"),{"scope":scope,"key":token,"payload":json.dumps(payload,sort_keys=True)})
    async def persist_bundle(self, artifacts, payload):
        request=artifacts["_request"]; scope=digest({"operator":payload["operatorTestId"],"tenant":request.scope.tenant_fingerprint,"scope":request.scope.scope_id})
        async with self.engine.begin() as conn:
            claim=(await conn.execute(text("SELECT request_hash FROM safety_change_request_claims WHERE operator_test_id=:o AND idempotency_key=:k FOR UPDATE"),{"o":payload["operatorTestId"],"k":payload["idempotencyKey"]})).first()
            if claim and claim.request_hash != payload["requestHash"]: raise RuntimeError("safety change quorum conflict recorded")
            await conn.execute(text("INSERT INTO safety_change_scopes(scope_hash,operator_test_id,tenant_fingerprint,scope_id,payload) VALUES(:s,:o,:t,:i,'{}') ON CONFLICT DO NOTHING"),{"s":scope,"o":payload["operatorTestId"],"t":request.scope.tenant_fingerprint,"i":request.scope.scope_id})
            for table,key,values in (("safety_change_requests","request_hash",[request]),("safety_change_qualification_evidence","evidence_hash",artifacts["_qualifications"]),("safety_change_approval_attestations","approval_hash",artifacts["_approvals"]),("safety_change_quorum_decisions","decision_hash",[artifacts["_decision"]]),("safety_change_apply_receipts","receipt_hash",[artifacts["_receipt"]])):
                for value in values: await self._put(conn,table,key,value,scope)
            if not claim: await conn.execute(text("INSERT INTO safety_change_request_claims(operator_test_id,idempotency_key,request_hash,scope_hash,payload) VALUES(:o,:k,:r,:s,'{}')"),{"o":payload["operatorTestId"],"k":payload["idempotencyKey"],"r":payload["requestHash"],"s":scope})
            run=await save_run(conn,payload)
            await conn.execute(text("INSERT INTO safety_change_test_center_bundles(run_id,scope_hash,decision_hash) VALUES(:r,:s,:d) ON CONFLICT DO NOTHING"),{"r":run["runId"],"s":scope,"d":artifacts["_decision"].decision_hash})
            return run
