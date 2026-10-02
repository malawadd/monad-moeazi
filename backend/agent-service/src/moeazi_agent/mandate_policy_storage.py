"""Pure evaluator state plus the closed async Timescale fixture repository."""
from __future__ import annotations
import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from .mandate_policy_canonical import digest
from .test_center_storage import save_run_on_connection

_TABLES=frozenset(("mandate_policy_registry_snapshots","mandate_policy_mandates","mandate_policy_draft_projections","mandate_policy_clause_mappings","mandate_policy_coverage_receipts","mandate_policy_compilations","mandate_policy_test_manifests","mandate_policy_test_receipts","mandate_policy_semantic_diffs","mandate_policy_diff_items","mandate_policy_consent_challenges","mandate_policy_consent_receipts","mandate_policy_activation_receipts","mandate_policy_boundary_receipts","mandate_policy_history_append_receipts","mandate_policy_transitions","mandate_policy_test_center_bundles"))

class MandatePolicyRepository:
    def __init__(self): self._claims={}; self._heads={}; self.conflicts=[]; self.bundles=[]
    def persist_bundle(self, operator: str, scope_hash: str, idempotency_key: str, request_hash: str, bundle: dict) -> dict:
        claim=(operator,idempotency_key); prior=self._claims.get(claim)
        if prior:
            if prior["requestHash"]==request_hash: return prior["bundle"]
            conflict={"conflictHash":digest({"claim":claim,"request":request_hash}),"reasonCode":"idempotency_conflict"}
            self.conflicts.append(conflict); raise RuntimeError("idempotency_conflict")
        activation=bundle.get("activation")
        if activation and activation.get("result")=="simulated_activated":
            head=self._heads.get(scope_hash)
            if activation.get("predecessorHash") != (head or {}).get("activationHash"): raise RuntimeError("activation_fork")
            self._heads[scope_hash]=activation
        stored={**bundle,"bundleHash":digest(bundle)}; self._claims[claim]={"requestHash":request_hash,"bundle":stored}; self.bundles.append(stored)
        return stored
    def current_head(self, scope_hash: str): return self._heads.get(scope_hash)

class TimescaleMandatePolicyRepository:
    """Append-only Test Center evidence; the product never imports this repository."""
    def __init__(self, engine: AsyncEngine): self.engine=engine
    async def _put(self, conn, table: str, scope: str, operator: str, artifact: dict) -> None:
        if table not in _TABLES: raise ValueError("mandate_policy_table_not_closed")
        body={key:value for key,value in artifact.items() if key!="_private"}; key=body.get("artifactHash") or body.get("activationHash") or body.get("boundaryHash") or body.get("consentHash") or body.get("nonceHash") or digest(body)
        if not isinstance(key,str) or len(key)!=64: key=digest(body)
        row=(await conn.execute(text(f"SELECT payload FROM {table} WHERE artifact_hash=:key AND scope_hash=:scope"),{"key":key,"scope":scope})).first()
        if row and dict(row.payload)!=body: raise RuntimeError("immutable_artifact_conflict")
        if not row:
            extracted={"predecessor":body.get("predecessorHash"),"sequence":body.get("sequence"),
                "run":body.get("runId") if table=="mandate_policy_test_center_bundles" else None}
            await conn.execute(text(f"INSERT INTO {table}(artifact_hash,scope_hash,operator_test_id,predecessor_hash,sequence,run_id,payload) VALUES(:key,:scope,:operator,:predecessor,:sequence,:run,CAST(:payload AS jsonb))"),{"key":key,"scope":scope,"operator":operator,**extracted,"payload":json.dumps(body,sort_keys=True,default=str)})
    async def _conflict(self, scope: str, operator: str, payload: dict) -> None:
        body={"scopeHash":scope,"operator":operator,"idempotencyKey":payload["idempotencyKey"],"requestHash":payload["requestHash"]}; body["artifactHash"]=digest(body)
        async with self.engine.begin() as conn:
            await conn.execute(text("INSERT INTO mandate_policy_conflicts(artifact_hash,scope_hash,operator_test_id,idempotency_key,payload) VALUES(:h,:s,:o,:k,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"h":body["artifactHash"],"s":scope,"o":operator,"k":payload["idempotencyKey"],"p":json.dumps(body,sort_keys=True)})
    async def persist_bundle(self, scope: dict, artifacts: dict, payload: dict, *, fail_at: str | None=None) -> dict:
        scope_hash=scope["scopeHash"]; operator=payload["operatorTestId"]; conflict=False
        async with self.engine.begin() as conn:
            claim=(await conn.execute(text("SELECT request_hash,scope_hash FROM mandate_policy_request_claims WHERE operator_test_id=:o AND idempotency_key=:k FOR UPDATE"),{"o":operator,"k":payload["idempotencyKey"]})).first()
            if claim and claim.request_hash!=payload["requestHash"]: conflict=True
            elif claim:
                row=(await conn.execute(text("SELECT payload FROM agent_test_center_runs WHERE operator_test_id=:o AND idempotency_key=:k"),{"o":operator,"k":payload["idempotencyKey"]})).first()
                if row: return dict(row.payload)
                raise RuntimeError("claim_without_run")
            else:
                await conn.execute(text("INSERT INTO mandate_policy_scopes(scope_hash,operator_test_id,tenant_fingerprint,user_fingerprint,account_fingerprint,environment,payload) VALUES(:h,:o,:t,:u,:a,:e,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"h":scope_hash,"o":operator,"t":scope["tenantFingerprint"],"u":scope["userFingerprint"],"a":scope["accountFingerprint"],"e":scope["environment"],"p":json.dumps(scope,sort_keys=True)})
                saved=(await conn.execute(text("SELECT operator_test_id,payload FROM mandate_policy_scopes WHERE scope_hash=:h FOR UPDATE"),{"h":scope_hash})).first()
                if not saved or saved.operator_test_id!=operator or dict(saved.payload)!=scope: raise RuntimeError("scope_binding_conflict")
                await conn.execute(text("INSERT INTO mandate_policy_request_claims(artifact_hash,scope_hash,operator_test_id,idempotency_key,request_hash,payload) VALUES(:h,:s,:o,:k,:r,CAST(:p AS jsonb))"),{"h":digest({"scope":scope_hash,"request":payload["requestHash"]}),"s":scope_hash,"o":operator,"k":payload["idempotencyKey"],"r":payload["requestHash"],"p":json.dumps({"requestHash":payload["requestHash"]})})
                activation=artifacts.get("mandate_policy_activation_receipts")
                if isinstance(activation,dict) and activation:
                    head=(await conn.execute(text("SELECT artifact_hash,sequence FROM mandate_policy_activation_receipts WHERE scope_hash=:s ORDER BY sequence DESC FOR UPDATE LIMIT 1"),{"s":scope_hash})).first()
                    predecessor=activation.get("predecessorHash")
                    if predecessor != (head.artifact_hash if head else None): raise RuntimeError("activation_fork")
                    if activation.get("sequence") != (head.sequence + 1 if head else 1): raise RuntimeError("activation_sequence")
                for table, rows in artifacts.items():
                    for row in rows if isinstance(rows,list) else [rows]: await self._put(conn,table,scope_hash,operator,row)
                if fail_at=="history": raise RuntimeError("injected_history_failure")
                run=await save_run_on_connection(conn,payload)
                activation=artifacts.get("mandate_policy_activation_receipts",{})
                activation_hash=activation.get("activationHash",digest(activation)) if isinstance(activation,dict) else digest(activation)
                await self._put(conn,"mandate_policy_test_center_bundles",scope_hash,operator,{"runId":run["runId"],"activationHash":activation_hash,"artifactHash":digest({"run":run["runId"],"activation":activation_hash})})
                return run
        if conflict:
            await self._conflict(claim.scope_hash,operator,payload); raise RuntimeError("mandate_policy_idempotency_conflict")

def test_center_bundle(scope_hash: str, operator: str, evidence: dict) -> tuple[dict, dict]:
    """Translate the closed evaluator output; callers cannot supply ledger rows."""
    compilation=evidence["compilation"]; receipt=compilation.receipt
    if receipt["scopeHash"] != scope_hash: raise RuntimeError("scope_receipt_mismatch")
    rows={
        "mandate_policy_compilations": {"artifactHash":receipt["policyHash"], **receipt},
        "mandate_policy_clause_mappings": [{"artifactHash":row["outputHash"],"fieldName":row["field"],"caseId":row["clauseId"],**row} for row in compilation.mappings],
        "mandate_policy_coverage_receipts": [{"artifactHash":row["valueHash"],"fieldName":row["field"],**row} for row in compilation.coverage],
        "mandate_policy_test_manifests": {"artifactHash":compilation.manifest["manifestHash"], **compilation.manifest},
        "mandate_policy_test_receipts": [{"artifactHash":row["caseHash"],**row} for row in compilation.manifest["cases"]],
        "mandate_policy_semantic_diffs": {"artifactHash":evidence["diff"]["diffHash"],**evidence["diff"]},
    }
    names={"challenge":"mandate_policy_consent_challenges","consent":"mandate_policy_consent_receipts","activation":"mandate_policy_activation_receipts","boundary":"mandate_policy_boundary_receipts"}
    for key,table in names.items():
        value=evidence.get(key)
        if isinstance(value,dict): rows[table]={"artifactHash":value.get(f"{key}Hash") or value.get("nonceHash") or digest(value),**value}
    if isinstance(evidence.get("boundary"),dict):
        boundary=evidence["boundary"]; rows["mandate_policy_history_append_receipts"]={"artifactHash":boundary["historyAppendHash"],"activationHash":boundary["activationHash"],"historyAppendHash":boundary["historyAppendHash"]}
    scope={"scopeHash":scope_hash,"tenantFingerprint":"tenant:fixture","userFingerprint":"user:fixture","accountFingerprint":"account:fixture","environment":"local"}
    return scope, rows
