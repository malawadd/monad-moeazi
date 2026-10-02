"""Append-only Timescale repository for the local, synthetic qualification ledger."""
from __future__ import annotations
import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from .test_center_storage import save_run_on_connection as save_run
from .operator_qualification_canonical import digest

_TABLES=frozenset(("operator_role_versions","operator_training_module_versions","operator_training_completion_receipts","operator_drill_scenario_versions","operator_drill_rubrics","operator_drill_attempts","operator_drill_action_receipts","operator_drill_oracle_receipts","operator_reviewer_calibrations","operator_independent_review_attestations","operator_qualification_decisions","operator_qualification_grants","operator_qualification_revocations","operator_qualification_consumption_receipts","operator_qualification_conflicts"))

class OperatorQualificationRepository:
    def __init__(self, engine: AsyncEngine): self.engine=engine
    async def _put(self, conn, table, key, value, scope):
        if table not in _TABLES: raise ValueError("operator qualification table is not closed")
        if value is None: return
        payload=value.model_dump(mode="json") if hasattr(value,"model_dump") else value; token=payload[key]
        row=(await conn.execute(text(f"SELECT payload FROM {table} WHERE {key}=:key"),{"key":token})).first()
        if row and dict(row.payload)!=payload: raise RuntimeError("operator qualification immutable content conflict")
        if not row: await conn.execute(text(f"INSERT INTO {table}(scope_hash,{key},payload) VALUES(:scope,:key,CAST(:payload AS jsonb))"),{"scope":scope,"key":token,"payload":json.dumps(payload,sort_keys=True)})
    async def _record_conflict(self, scope, payload):
        body={"scope_hash":scope,"idempotency_key":payload["idempotencyKey"],"request_hash":payload["requestHash"]}
        body["conflict_hash"]=digest(body)
        async with self.engine.begin() as conn:
            await self._put(conn,"operator_qualification_conflicts","conflict_hash",body,scope)
    async def persist_bundle(self, artifacts, payload):
        scope=artifacts["scope"].scope_hash
        conflict_scope=None
        async with self.engine.begin() as conn:
            claim=(await conn.execute(text("SELECT request_hash,scope_hash FROM operator_qualification_request_claims WHERE operator_test_id=:o AND idempotency_key=:k FOR UPDATE"),{"o":payload["operatorTestId"],"k":payload["idempotencyKey"]})).first()
            conflict_scope=claim.scope_hash if claim and claim.request_hash != payload["requestHash"] else None
            if not conflict_scope:
                await conn.execute(text("INSERT INTO operator_qualification_scopes(scope_hash,operator_test_id,tenant_fingerprint,scope_id,environment,payload) VALUES(:h,:o,:t,:s,:e,'{}') ON CONFLICT DO NOTHING"),{"h":scope,"o":payload["operatorTestId"],"t":artifacts["scope"].tenant_fingerprint,"s":artifacts["scope"].scope_id,"e":artifacts["scope"].environment})
                entries=(("operator_role_versions","role_hash",[artifacts["role"]]),("operator_training_module_versions","module_hash",[artifacts["module"]]),("operator_training_completion_receipts","receipt_hash",[artifacts["training"]]),("operator_drill_scenario_versions","scenario_hash",[artifacts["scenario"]]),("operator_drill_rubrics","rubric_hash",[artifacts["rubric"]]),("operator_drill_attempts","attempt_hash",[artifacts["attempt"]]),("operator_drill_action_receipts","action_hash",artifacts["actions"]),("operator_drill_oracle_receipts","oracle_hash",[artifacts["oracle"]]),("operator_reviewer_calibrations","calibration_hash",[artifacts["calibration"]]),("operator_independent_review_attestations","review_hash",[artifacts["review"]]),("operator_qualification_decisions","decision_hash",[artifacts["decision"]]),("operator_qualification_grants","grant_hash",[artifacts["grant"]]),("operator_qualification_revocations","revocation_hash",artifacts["revocations"]),("operator_qualification_consumption_receipts","receipt_hash",[artifacts["consumption"]]))
                for table,key,values in entries:
                    for value in values: await self._put(conn,table,key,value,scope)
                if not claim: await conn.execute(text("INSERT INTO operator_qualification_request_claims(operator_test_id,idempotency_key,request_hash,scope_hash,payload) VALUES(:o,:k,:r,:s,'{}')"),{"o":payload["operatorTestId"],"k":payload["idempotencyKey"],"r":payload["requestHash"],"s":scope})
                run=await save_run(conn,payload)
                await conn.execute(text("INSERT INTO operator_qualification_test_center_bundles(run_id,scope_hash,decision_hash) VALUES(:r,:s,:d) ON CONFLICT DO NOTHING"),{"r":run["runId"],"s":scope,"d":artifacts["decision"].decision_hash})
                return run
        if conflict_scope:
            await self._record_conflict(conflict_scope,payload)
            raise RuntimeError("operator qualification conflict recorded")
    async def current_grants(self, operator: str, tenant: str, scope_id: str):
        async with self.engine.connect() as conn:
            rows=await conn.execute(text("SELECT g.payload FROM operator_qualification_grants g JOIN operator_qualification_scopes s ON s.scope_hash=g.scope_hash WHERE s.operator_test_id=:o AND s.tenant_fingerprint=:t AND s.scope_id=:s"),{"o":operator,"t":tenant,"s":scope_id})
            return [dict(row.payload) for row in rows]
