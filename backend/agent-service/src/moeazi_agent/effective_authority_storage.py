"""Append-only repository helpers; claims are exact and mismatch records are conflicts."""
from __future__ import annotations
import json
from sqlalchemy import text
from .effective_authority_canonical import digest
from .test_center_storage import save_run_on_connection
class EffectiveAuthorityRepository:
    def __init__(self, engine): self.engine=engine
    async def _conflict(self, scope, operator, key, request):
        body={"scope":scope,"operator":operator,"key":key,"request":request}
        async with self.engine.begin() as conn:
            await conn.execute(text("INSERT INTO effective_authority_conflicts(artifact_hash,scope_hash,operator_test_id,idempotency_key,request_hash,payload) VALUES(:h,:s,:o,:k,:r,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"h":digest(body),"s":scope,"o":operator,"k":key,"r":request,"p":json.dumps(body,sort_keys=True)})
    async def persist_bundle(self, operator:str, idempotency_key:str, request_hash:str, scope, artifacts:dict, payload:dict, fail_at=None):
        conflict_scope=None
        async with self.engine.begin() as conn:
            claim=(await conn.execute(text("SELECT request_hash,scope_hash,payload FROM effective_authority_request_claims WHERE operator_test_id=:o AND idempotency_key=:k FOR UPDATE"),{"o":operator,"k":idempotency_key})).first()
            if claim and claim.request_hash == request_hash: return dict(claim.payload)
            if claim: conflict_scope=claim.scope_hash
            if conflict_scope: pass
            else:
             await conn.execute(text("INSERT INTO effective_authority_scopes(scope_hash,operator_test_id,tenant_fingerprint,payload) VALUES(:s,:o,:t,'{}') ON CONFLICT DO NOTHING"),{"s":scope.scope_hash,"o":operator,"t":scope.tenant_fingerprint})
             values=[("effective_authority_source_receipts","receipt_hash",item.source) for item in artifacts["gates"]]+[("effective_authority_gate_results","result_hash",item) for item in artifacts["gates"]]+[("effective_authority_decisions","decision_hash",artifacts["decision"])]
             for table,key,item in values:
                body=item.model_dump(mode="json"); token=body[key]
                await conn.execute(text(f"INSERT INTO {table}(artifact_hash,scope_hash,operator_test_id,sequence,payload) VALUES(:h,:s,:o,:q,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"h":token,"s":scope.scope_hash,"o":operator,"q":body.get("sequence"),"p":json.dumps(body,sort_keys=True)})
             for table,item in artifacts.get("graph",{}).items():
                if table not in {"effective_authority_registry_snapshots","effective_authority_owner_heads","effective_authority_gate_edges","effective_authority_input_manifests","effective_authority_reason_projections","effective_authority_explanations","effective_authority_enforcement_comparisons","effective_authority_transitions"}: raise ValueError("effective_authority_table_not_allowed")
                await conn.execute(text(f"INSERT INTO {table}(artifact_hash,scope_hash,operator_test_id,payload) VALUES(:h,:s,:o,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"h":item["artifact_hash"],"s":scope.scope_hash,"o":operator,"p":json.dumps(item["payload"],sort_keys=True)})
             if fail_at: raise RuntimeError("injected_effective_authority_failure")
             saved=await save_run_on_connection(conn,payload); claim_hash=digest({"operator":operator,"idempotency":idempotency_key,"request":request_hash})
             await conn.execute(text("INSERT INTO effective_authority_test_center_bundles(artifact_hash,scope_hash,operator_test_id,payload) VALUES(:h,:s,:o,CAST(:p AS jsonb))"),{"h":digest({"run":saved["runId"],"decision":artifacts["decision"].decision_hash}),"s":scope.scope_hash,"o":operator,"p":json.dumps({"runId":saved["runId"]},sort_keys=True)})
             await conn.execute(text("INSERT INTO effective_authority_request_claims(artifact_hash,scope_hash,operator_test_id,idempotency_key,request_hash,payload) VALUES(:h,:s,:o,:k,:r,CAST(:p AS jsonb))"),{"h":claim_hash,"s":scope.scope_hash,"o":operator,"k":idempotency_key,"r":request_hash,"p":json.dumps(saved,sort_keys=True)})
             return saved
        if conflict_scope:
            await self._conflict(conflict_scope,operator,idempotency_key,request_hash); raise RuntimeError("effective_authority_idempotency_conflict")
