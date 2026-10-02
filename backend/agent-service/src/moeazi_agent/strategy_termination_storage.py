"""Append-only latch-first persistence for Feature 14 local fixture bundles."""
from __future__ import annotations
import json
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncEngine
from .strategy_termination_canonical import digest
from .strategy_termination_workflow_contracts import TerminationConflictReceipt
from .test_center_storage import save_run_on_connection

class StrategyTerminationRepository:
    def __init__(self, engine: AsyncEngine): self.engine=engine
    async def prerequisites(self, operator: str) -> list[dict]:
        async with self.engine.connect() as conn:
            rows=await conn.execute(text("SELECT run_id,feature_id,scenario_id,registry_hash,control_hash,fixture_hash,invariant_verdict FROM agent_test_center_runs WHERE operator_test_id=:o AND feature_id IN ('cross-state-recovery-continuity','intent-execution-equivalence') ORDER BY run_id"),{"o":operator})
            return [{"runId":r.run_id,"featureId":r.feature_id,"scenarioId":r.scenario_id,"status":r.invariant_verdict,"registryHash":r.registry_hash,"controlHash":r.control_hash,"fixtureHash":r.fixture_hash} for r in rows]
    async def selected_prerequisites(self, operator: str, ids: dict[str,str]) -> dict:
        if set(ids)!={"cross-state-recovery-continuity","intent-execution-equivalence"}: raise RuntimeError("exact Feature 02 and Feature 11 run IDs are required")
        query=text("SELECT run_id,feature_id,registry_hash,control_hash,fixture_hash,payload FROM agent_test_center_runs WHERE operator_test_id=:o AND run_id IN :ids").bindparams(bindparam("ids",expanding=True))
        async with self.engine.connect() as conn: rows=await conn.execute(query,{"o":operator,"ids":list(ids.values())})
        selected={r.feature_id:r for r in rows}
        if set(selected)!=set(ids) or any(selected[k].run_id!=ids[k] for k in ids): raise RuntimeError("selected prerequisite is unavailable for this operator")
        result={}
        for feature,row in selected.items():
            payload=dict(row.payload); value=payload.get("result",{})
            product = value.get("productOutcome", payload.get("auditSnapshot", {}).get("productAvailability"))
            if payload.get("featureId")!=feature or product!="unavailable" or payload.get("invariantVerdict")!="pass": raise RuntimeError("selected prerequisite is not a valid local fixture result")
            result[feature]={"runId":row.run_id,"runHash":digest({"run":row.run_id,"request":payload.get("requestHash")}),"bundleHash":digest({"bundle":row.run_id,"fixture":row.fixture_hash}),"controlHash":row.control_hash,"registryHash":row.registry_hash}
        return result
    async def _put(self, conn, table, key, value, scope):
        encoded=value.model_dump(mode="json"); item=getattr(value,key)
        row=(await conn.execute(text(f"SELECT payload FROM {table} WHERE {key}=:h"),{"h":item})).first()
        if row and dict(row.payload)!=encoded: raise RuntimeError(f"termination {table} conflict")
        if not row: await conn.execute(text(f"INSERT INTO {table}(scope_hash,{key},payload) VALUES(:s,:h,CAST(:p AS jsonb))"),{"s":scope,"h":item,"p":json.dumps(encoded,sort_keys=True)})
    async def _conflict(self, scope, request_hash, reason):
        body={"scope_hash":scope,"request_hash":request_hash,"reason_code":reason}; conflict=TerminationConflictReceipt(**body,conflict_hash=digest(body))
        async with self.engine.begin() as conn: await self._put(conn,"termination_conflicts","conflict_hash",conflict,scope)
        raise RuntimeError("termination conflict recorded")
    async def persist_bundle(self, artifacts: dict, payload: dict, *, fail_after_latch: bool=False) -> dict:
        scope=artifacts["_scope"]; request=artifacts["_request"]; latch=artifacts["_latch"]
        async with self.engine.connect() as conn:
            known=(await conn.execute(text("SELECT test_request_hash FROM termination_request_claims WHERE operator_test_id=:o AND scope_hash=:s AND idempotency_key=:k"),{"o":scope.operator_test_id,"s":scope.scope_hash,"k":payload["idempotencyKey"]})).first()
        if known and known.test_request_hash!=payload["requestHash"]:
            await self._conflict(scope.scope_hash,payload["requestHash"],"changed_request")
        async with self.engine.begin() as conn:
            scope_row=(await conn.execute(text("SELECT payload FROM termination_scopes WHERE scope_hash=:s"),{"s":scope.scope_hash})).first()
            if scope_row and dict(scope_row.payload)!=scope.model_dump(mode="json"): raise RuntimeError("termination scope conflict")
            if not scope_row: await conn.execute(text("INSERT INTO termination_scopes(scope_hash,operator_test_id,payload) VALUES(:s,:o,CAST(:p AS jsonb))"),{"s":scope.scope_hash,"o":scope.operator_test_id,"p":json.dumps(scope.model_dump(mode="json"),sort_keys=True)})
            claim=(await conn.execute(text("SELECT test_request_hash FROM termination_request_claims WHERE operator_test_id=:o AND scope_hash=:s AND idempotency_key=:k FOR UPDATE"),{"o":scope.operator_test_id,"s":scope.scope_hash,"k":payload["idempotencyKey"]})).first()
            if claim and claim.test_request_hash!=payload["requestHash"]: raise RuntimeError("termination idempotency conflict")
            await self._put(conn,"termination_requests","request_hash",request,scope.scope_hash); await self._put(conn,"termination_latches","latch_hash",latch,scope.scope_hash)
            for event in artifacts["_transitions"]: await self._put(conn,"termination_workflow_events","event_hash",event,scope.scope_hash)
            if not claim: await conn.execute(text("INSERT INTO termination_request_claims(operator_test_id,scope_hash,idempotency_key,request_hash,test_request_hash,payload) VALUES(:o,:s,:k,:r,:t,'{}'::jsonb)"),{"o":scope.operator_test_id,"s":scope.scope_hash,"k":payload["idempotencyKey"],"r":request.request_hash,"t":payload["requestHash"]})
        if fail_after_latch: raise RuntimeError("injected failure after durable latch")
        async with self.engine.begin() as conn:
            prior=(await conn.execute(text("SELECT r.payload FROM termination_test_center_bundles b JOIN agent_test_center_runs r ON r.run_id=b.run_id WHERE b.scope_hash=:s"),{"s":scope.scope_hash})).first()
            if prior: return dict(prior.payload)
            groups=(("termination_dependency_bindings","binding_hash","_dependencies"),("termination_observations","observation_hash","_observations"),("termination_inventory_items","item_hash","_items"),("termination_steps","step_hash","_steps"),("termination_attempts","attempt_hash","_attempts"),("termination_step_receipts","receipt_hash","_receipts"),("termination_checkpoints","checkpoint_hash","_checkpoints"),("termination_residuals","residual_hash","_residuals"))
            for table,key,name in groups:
                for value in artifacts[name]: await self._put(conn,table,key,value,scope.scope_hash)
            singles=(("termination_context_bindings","binding_hash","_context"),("termination_manifests","manifest_hash","_manifest"),("termination_snapshots","snapshot_hash","_snapshot"),("termination_plans","plan_hash","_plan"),("termination_decisions","decision_hash","_decision"))
            for table,key,name in singles: await self._put(conn,table,key,artifacts[name],scope.scope_hash)
            if artifacts["_completion"]: await self._put(conn,"termination_completions","completion_hash",artifacts["_completion"],scope.scope_hash)
            run=await save_run_on_connection(conn,payload)
            await conn.execute(text("INSERT INTO termination_test_center_bundles(run_id,scope_hash,decision_hash) VALUES(:r,:s,:d)"),{"r":run["runId"],"s":scope.scope_hash,"d":artifacts["_decision"].decision_hash})
            return run
