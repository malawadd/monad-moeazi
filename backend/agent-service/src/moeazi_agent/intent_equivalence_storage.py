"""Atomic append-only persistence for a complete local equivalence bundle."""
from __future__ import annotations
import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from .intent_equivalence_contracts import IntentEquivalenceReceipt
from .test_center_storage import save_run_on_connection

class IntentEquivalenceRepository:
    def __init__(self, engine: AsyncEngine): self.engine = engine
    async def persist_bundle(self, result: dict, payload: dict) -> dict:
        intent, envelope, plan, context, receipt = (result["_intent"], result["_envelope"], result["_plan"], result["_context"], result["_receipt"])
        artifacts, checks = result["_artifacts"], result["_checks"]
        if receipt.outcome == "pass" and result["actualOutcome"] != "pass": raise RuntimeError("equivalence result binding failed")
        scope = intent.scope.scope_hash; request_hash = payload["requestHash"]
        async with self.engine.begin() as conn:
            locks = sorted([f"{scope}:{envelope.idempotency_key}", f"{scope}:{artifacts[0].artifact_hash}"])
            for lock in locks: await conn.execute(text("SELECT pg_advisory_xact_lock(hashtext(:lock))"), {"lock": lock})
            prior = (await conn.execute(text("SELECT request_hash,payload FROM equivalence_request_receipts WHERE scope_hash=:scope AND idempotency_key=:key"), {"scope":scope,"key":envelope.idempotency_key})).first()
            if prior:
                if prior.request_hash != request_hash: raise RuntimeError("equivalence idempotency conflict")
                return dict(prior.payload)["run"]
            def dumped(item): return json.dumps(item.model_dump(mode="json"), sort_keys=True)
            prior_intent = (await conn.execute(text("SELECT payload FROM equivalence_reviewed_intents WHERE scope_hash=:s AND intent_hash=:h"), {"s":scope,"h":intent.intent_hash})).first()
            if prior_intent and dict(prior_intent.payload) != intent.model_dump(mode="json"):
                raise RuntimeError("equivalence reviewed intent collision")
            if not prior_intent:
                await conn.execute(text("INSERT INTO equivalence_reviewed_intents(scope_hash,intent_hash,payload) VALUES(:s,:h,CAST(:p AS jsonb))"), {"s":scope,"h":intent.intent_hash,"p":dumped(intent)})
            await conn.execute(text("INSERT INTO equivalence_envelopes(scope_hash,envelope_hash,intent_hash,idempotency_key,request_hash,payload) VALUES(:s,:h,:i,:k,:r,CAST(:p AS jsonb))"), {"s":scope,"h":envelope.envelope_hash,"i":intent.intent_hash,"k":envelope.idempotency_key,"r":request_hash,"p":dumped(envelope)})
            for item in artifacts: await conn.execute(text("INSERT INTO equivalence_artifacts(scope_hash,observation_hash,envelope_hash,artifact_hash,stage,payload) VALUES(:s,:o,:e,:a,:g,CAST(:p AS jsonb))"), {"s":scope,"o":item.observation_hash,"e":envelope.envelope_hash,"a":item.artifact_hash,"g":item.stage,"p":dumped(item)})
            async def immutable(table, item, key):
                prior = (await conn.execute(text(f"SELECT payload FROM {table} WHERE scope_hash=:s AND {key}=:h"), {"s":scope,"h":getattr(item,key)})).first()
                if prior and dict(prior.payload) != item.model_dump(mode="json"): raise RuntimeError(f"equivalence {table} collision")
                if not prior: await conn.execute(text(f"INSERT INTO {table}(scope_hash,{key},envelope_hash,payload) VALUES(:s,:h,:e,CAST(:p AS jsonb))"), {"s":scope,"h":getattr(item,key),"e":envelope.envelope_hash,"p":dumped(item)})
            for table, item, key in (("equivalence_decoded_plans",plan,"plan_hash"),("equivalence_contexts",context,"context_hash"),("equivalence_checks",None,"check_hash")):
                for value in checks if item is None else [item]: await immutable(table, value, key)
            await conn.execute(text("INSERT INTO equivalence_receipts(scope_hash,receipt_hash,envelope_hash,outcome,payload) VALUES(:s,:h,:e,:o,CAST(:p AS jsonb))"), {"s":scope,"h":receipt.receipt_hash,"e":envelope.envelope_hash,"o":receipt.outcome,"p":dumped(receipt)})
            run = await save_run_on_connection(conn, payload)
            saved = {"run":run,"receiptHash":receipt.receipt_hash}
            await conn.execute(text("INSERT INTO equivalence_request_receipts(scope_hash,idempotency_key,request_hash,receipt_hash,outcome,payload) VALUES(:s,:k,:r,:h,'completed',CAST(:p AS jsonb))"), {"s":scope,"k":envelope.idempotency_key,"r":request_hash,"h":receipt.receipt_hash,"p":json.dumps(saved,sort_keys=True)})
            await conn.execute(text("INSERT INTO equivalence_test_center_bundles(run_id,scope_hash,envelope_hash,receipt_hash) VALUES(:r,:s,:e,:h)"), {"r":run["runId"],"s":scope,"e":envelope.envelope_hash,"h":receipt.receipt_hash})
            return run
