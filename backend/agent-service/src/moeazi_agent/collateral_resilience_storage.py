"""Atomic append-only persistence for Feature 13 Test Center artifacts."""
from __future__ import annotations
import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from .test_center_storage import save_run_on_connection

class CollateralResilienceRepository:
    def __init__(self, engine: AsyncEngine): self.engine = engine
    async def persist_bundle(self, artifacts: dict, payload: dict) -> dict:
        scope, envelope = artifacts["_scope"], artifacts["_envelope"]
        async with self.engine.begin() as conn:
            await conn.execute(text("SELECT pg_advisory_xact_lock(hashtext(:lock))"), {"lock": f"{scope.scope_hash}:{payload['idempotencyKey']}"})
            prior = (await conn.execute(text("SELECT request_hash,payload FROM collateral_resilience_request_claims WHERE scope_hash=:s AND idempotency_key=:k FOR UPDATE"), {"s":scope.scope_hash,"k":payload["idempotencyKey"]})).first()
            if prior:
                if prior.request_hash != payload["requestHash"]: raise RuntimeError("collateral resilience idempotency conflict")
                return dict(prior.payload)["run"]
            async def put(table: str, key: str, value):
                encoded = value.model_dump(mode="json")
                item_hash = getattr(value, key)
                prior_row = (await conn.execute(text(f"SELECT payload FROM {table} WHERE scope_hash=:s AND {key}=:h"), {"s":scope.scope_hash,"h":item_hash})).first()
                if prior_row and dict(prior_row.payload) != encoded: raise RuntimeError(f"collateral resilience {table} conflict")
                if not prior_row:
                    cols = "scope_hash,payload" if key == "scope_hash" else f"scope_hash,{key},payload"
                    vals = ":s,CAST(:p AS jsonb)" if key == "scope_hash" else ":s,:h,CAST(:p AS jsonb)"
                    await conn.execute(text(f"INSERT INTO {table}({cols}) VALUES({vals})"), {"s":scope.scope_hash,"h":item_hash,"p":json.dumps(encoded, sort_keys=True)})
            await put("collateral_resilience_scopes", "scope_hash", scope)
            await put("collateral_resilience_feature12_bindings", "binding_hash", artifacts["_binding"])
            for table, key, item in (("collateral_resilience_balances", "observation_hash", artifacts["_balance"]), ("collateral_resilience_positions", "observation_hash", artifacts["_position"]), ("collateral_resilience_funding_borrow", "observation_hash", artifacts["_funding"]), ("collateral_resilience_liquidity", "observation_hash", artifacts["_liquidity"])): await put(table, key, item)
            for item in artifacts["_dependencies"]: await put("collateral_resilience_dependencies", "observation_hash", item)
            await put("collateral_resilience_envelopes", "envelope_hash", envelope)
            run = await save_run_on_connection(conn, payload)
            saved = {"run": run, "envelopeHash": envelope.envelope_hash}
            await conn.execute(text("INSERT INTO collateral_resilience_request_claims(scope_hash,idempotency_key,request_hash,envelope_hash,payload) VALUES(:s,:k,:r,:e,CAST(:p AS jsonb))"), {"s":scope.scope_hash,"k":payload["idempotencyKey"],"r":payload["requestHash"],"e":envelope.envelope_hash,"p":json.dumps(saved, sort_keys=True)})
            await conn.execute(text("INSERT INTO collateral_resilience_test_center_bundles(run_id,scope_hash,envelope_hash) VALUES(:r,:s,:e)"), {"r":run["runId"],"s":scope.scope_hash,"e":envelope.envelope_hash})
            return run
