"""Repository claim semantics for the isolated consent graph; no Redis replay state."""
from __future__ import annotations
import json
from sqlalchemy import text
from .test_center_storage import save_run_on_connection
from .risk_tiered_consent_canonical import digest
class RiskTieredConsentRepository:
    def __init__(self,engine): self.engine=engine
    async def _verify_retry(self,conn,operator,key,scope_hash):
        row=(await conn.execute(text("SELECT (SELECT count(*) FROM risk_tiered_consent_feature19_contexts WHERE operator_test_id=:o AND scope_hash=:s)>0 AS context_ok,(SELECT count(*) FROM risk_tiered_consent_source_receipts WHERE operator_test_id=:o AND scope_hash=:s)>=9 AS sources_ok,(SELECT count(*) FROM risk_tiered_consent_lifecycle_transitions WHERE operator_test_id=:o AND scope_hash=:s)>0 AS lifecycle_ok,(SELECT count(*) FROM risk_tiered_consent_request_claims WHERE operator_test_id=:o AND idempotency_key=:k)=1 AS claim_ok"),{"o":operator,"k":key,"s":scope_hash})).first()
        if not row or not all(row): raise RuntimeError("risk_tiered_consent_retry_graph_invalid")
    async def persist_bundle(self,operator,key,request_hash,artifacts,payload,fail_at=False):
        scope=artifacts["scope"]
        required={"scope","manifest","assessment","feature19_context","execution"}
        if not required<=set(artifacts) or (artifacts["packet"] is not None and artifacts["receipt"] is None): raise RuntimeError("risk_tiered_consent_incomplete_graph")
        async with self.engine.begin() as conn:
            await conn.execute(text("SELECT pg_advisory_xact_lock(hashtext(:claim))"),{"claim":f"{operator}:{key}"})
            prior=(await conn.execute(text("SELECT request_hash,payload FROM risk_tiered_consent_request_claims WHERE operator_test_id=:o AND idempotency_key=:k FOR UPDATE"),{"o":operator,"k":key})).first()
            if prior:
                if prior.request_hash==request_hash:
                    await self._verify_retry(conn,operator,key,scope.scope_hash); return dict(prior.payload)
            else:
                await conn.execute(text("INSERT INTO risk_tiered_consent_scopes(operator_test_id,scope_hash,proposal_fingerprint,payload) VALUES(:o,:s,:p,CAST(:v AS jsonb))"),{"o":operator,"s":scope.scope_hash,"p":scope.proposal_fingerprint,"v":json.dumps(scope.model_dump(mode="json"),sort_keys=True)})
                for kind,item in artifacts.items():
                    if item is not None and kind not in {"scope","execution"}:
                        rows=item.sources if kind=="manifest" else (item,); stored_kind="source" if kind=="manifest" else kind
                        for row in rows:
                            body=row.model_dump(mode="json"); artifact_hash=body.get("source_hash") or body.get(f"{kind}_hash")
                            artifact_hash=artifact_hash or digest(body)
                            if kind=="manifest": await conn.execute(text("INSERT INTO risk_tiered_consent_source_receipts(operator_test_id,scope_hash,source_id,sequence,artifact_hash,predecessor_hash,payload) VALUES(:o,:s,:i,:q,:h,:p,CAST(:v AS jsonb))"),{"o":operator,"s":scope.scope_hash,"i":row.source_id,"q":row.sequence,"h":artifact_hash,"p":row.predecessor_hash,"v":json.dumps(body,sort_keys=True)})
                            await conn.execute(text("INSERT INTO risk_tiered_consent_artifacts(operator_test_id,scope_hash,artifact_kind,artifact_hash,payload) VALUES(:o,:s,:k,:h,CAST(:v AS jsonb))"),{"o":operator,"s":scope.scope_hash,"k":stored_kind,"h":artifact_hash,"v":json.dumps(body,sort_keys=True)})
                context=artifacts["feature19_context"]
                await conn.execute(text("INSERT INTO risk_tiered_consent_feature19_contexts(operator_test_id,scope_hash,run_id,context_hash,payload) VALUES(:o,:s,:r,:h,CAST(:v AS jsonb))"),{"o":operator,"s":scope.scope_hash,"r":context.run_id,"h":digest(context.model_dump(mode="json")),"v":json.dumps(context.model_dump(mode="json"),sort_keys=True)})
                packet=artifacts.get("packet"); receipt=artifacts.get("receipt")
                if packet: await conn.execute(text("INSERT INTO risk_tiered_consent_packets(operator_test_id,scope_hash,packet_hash,challenge_hash,expires_at,payload) VALUES(:o,:s,:p,:c,:e,CAST(:v AS jsonb))"),{"o":operator,"s":scope.scope_hash,"p":packet.packet_hash,"c":packet.challenge_hash,"e":packet.expires_at,"v":json.dumps(packet.model_dump(mode="json"),sort_keys=True)})
                if receipt: await conn.execute(text("INSERT INTO risk_tiered_consent_nonce_consumptions(operator_test_id,scope_hash,challenge_hash,receipt_hash,outcome,payload) VALUES(:o,:s,:c,:r,:u,CAST(:v AS jsonb))"),{"o":operator,"s":scope.scope_hash,"c":receipt.challenge_hash,"r":receipt.receipt_hash,"u":receipt.outcome,"v":json.dumps(receipt.model_dump(mode="json"),sort_keys=True)})
                transition={"state":receipt.outcome if receipt else artifacts["assessment"].issuance,"packetHash":packet.packet_hash if packet else None}
                await conn.execute(text("INSERT INTO risk_tiered_consent_lifecycle_transitions(operator_test_id,scope_hash,sequence,artifact_hash,payload) VALUES(:o,:s,1,:h,CAST(:v AS jsonb))"),{"o":operator,"s":scope.scope_hash,"h":digest(transition),"v":json.dumps(transition,sort_keys=True)})
                if fail_at: raise RuntimeError("injected_risk_tiered_consent_failure")
                saved=await save_run_on_connection(conn,payload)
                await conn.execute(text("INSERT INTO risk_tiered_consent_request_claims(operator_test_id,idempotency_key,request_hash,payload) VALUES(:o,:k,:r,CAST(:v AS jsonb))"),{"o":operator,"k":key,"r":request_hash,"v":json.dumps(saved,sort_keys=True)})
                return saved
        async with self.engine.begin() as conn: await conn.execute(text("INSERT INTO risk_tiered_consent_conflicts(operator_test_id,idempotency_key,request_hash,payload) VALUES(:o,:k,:r,'{}') ON CONFLICT DO NOTHING"),{"o":operator,"k":key,"r":request_hash})
        raise RuntimeError("risk_tiered_consent_idempotency_conflict")
