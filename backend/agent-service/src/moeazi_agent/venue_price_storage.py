"""Atomic append-only persistence for local venue-price fixture graphs."""
from __future__ import annotations
import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from .test_center_storage import save_run_on_connection


class VenuePriceRepository:
    def __init__(self, engine: AsyncEngine): self.engine = engine

    async def persist_bundle(self, artifacts: dict, payload: dict) -> dict:
        scope, decision = artifacts["_scope"], artifacts["_decision"]
        request_hash = payload["requestHash"]
        async with self.engine.begin() as conn:
            for lock in sorted((f"{scope.scope_hash}:{decision.idempotency_key}", f"{scope.scope_hash}:{decision.decision_hash}")):
                await conn.execute(text("SELECT pg_advisory_xact_lock(hashtext(:lock))"), {"lock": lock})
            prior = (await conn.execute(text("SELECT request_hash,payload FROM venue_price_request_receipts WHERE scope_hash=:s AND idempotency_key=:k"), {"s":scope.scope_hash,"k":decision.idempotency_key})).first()
            if prior:
                if prior.request_hash != request_hash: raise RuntimeError("venue price idempotency conflict")
                return dict(prior.payload)["run"]
            def dump(value): return json.dumps(value.model_dump(mode="json"), sort_keys=True)
            async def put(table, key, value, extra=""):
                previous = (await conn.execute(text(f"SELECT payload FROM {table} WHERE scope_hash=:s AND {key}=:h"), {"s":scope.scope_hash,"h":getattr(value,key)})).first()
                if previous and dict(previous.payload) != value.model_dump(mode="json"): raise RuntimeError(f"venue price {table} conflict")
                if not previous:
                    columns = "scope_hash,payload" if key == "scope_hash" else f"scope_hash,{key},payload{extra}"
                    values = ":s,CAST(:p AS jsonb)" if key == "scope_hash" else f":s,:h,CAST(:p AS jsonb){',:e' if extra else ''}"
                    await conn.execute(text(f"INSERT INTO {table}({columns}) VALUES({values})"), {"s":scope.scope_hash,"h":getattr(value,key),"p":dump(value),"e":decision.decision_hash})
            await put("venue_price_scopes", "scope_hash", scope)
            for item in artifacts["_specs"]: await put("venue_price_source_specs", "spec_hash", item)
            await put("venue_price_semantics", "semantics_hash", artifacts["_semantics"])
            for item in artifacts["_observations"]: await put("venue_price_observations", "observation_hash", item)
            await put("venue_price_feature07_bindings", "binding_hash", artifacts["_binding"])
            for item in artifacts["_receipts"]: await put("venue_price_receipts", "receipt_hash", item)
            await put("venue_price_decisions", "decision_hash", decision)
            run = await save_run_on_connection(conn, payload)
            saved = {"run": run, "decisionHash": decision.decision_hash}
            await conn.execute(text("INSERT INTO venue_price_request_receipts(scope_hash,idempotency_key,request_hash,decision_hash,payload) VALUES(:s,:k,:r,:d,CAST(:p AS jsonb))"), {"s":scope.scope_hash,"k":decision.idempotency_key,"r":request_hash,"d":decision.decision_hash,"p":json.dumps(saved,sort_keys=True)})
            await conn.execute(text("INSERT INTO venue_price_test_center_bundles(run_id,scope_hash,decision_hash) VALUES(:r,:s,:d)"), {"r":run["runId"],"s":scope.scope_hash,"d":decision.decision_hash})
            return run
