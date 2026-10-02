"""Atomic append-only storage for Feature 22 local fixture bundles."""
from __future__ import annotations
import json
from sqlalchemy import text


class ProductEligibilityConflict(RuntimeError):
    """A changed idempotency retry; callers map it to a sanitized 409."""


class ProductEligibilityRepository:
    def __init__(self, engine): self.engine = engine

    @staticmethod
    def _json(value):
        if hasattr(value, "model_dump"): value = value.model_dump(mode="json")
        return json.dumps(value, separators=(",", ":"), sort_keys=True)

    async def persist_bundle(self, operator, idempotency_key, request_hash, scope,
                             artifacts, payload, failpoint=None):
        request, decision = artifacts["request"], artifacts["decision"]
        conflict = False
        async with self.engine.begin() as conn:
            await conn.execute(text("SELECT pg_advisory_xact_lock(hashtext(:v))"),
                               {"v": f"product-eligibility:{operator}:{idempotency_key}"})
            row = (await conn.execute(text("""SELECT request_hash,payload FROM
              product_eligibility_request_claims WHERE operator_test_id=:o
              AND idempotency_key=:k FOR UPDATE"""),
              {"o": operator, "k": idempotency_key})).mappings().first()
            if row:
                if row["request_hash"] == request_hash: return dict(row["payload"])
                await conn.execute(text("""INSERT INTO product_eligibility_conflicts
                  (operator_test_id,idempotency_key,request_hash,payload)
                  VALUES(:o,:k,:r,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"""),
                  {"o": operator, "k": idempotency_key, "r": request_hash,
                   "p": self._json({"code": "IDEMPOTENCY_CONFLICT"})})
                conflict = True
            else:
                await self._write(conn, operator, scope.scope_hash, request, decision,
                                  payload, failpoint)
                await conn.execute(text("""INSERT INTO product_eligibility_request_claims
                  (operator_test_id,idempotency_key,request_hash,payload)
                  VALUES(:o,:k,:r,CAST(:p AS jsonb))"""),
                  {"o": operator, "k": idempotency_key, "r": request_hash,
                   "p": self._json(payload)})
        if conflict: raise ProductEligibilityConflict("product_eligibility_idempotency_conflict")
        return await self.read_claim(operator, idempotency_key, request_hash)

    async def _write(self, conn, operator, scope_hash, request, decision, payload, failpoint):
        args = {"o": operator, "s": scope_hash}
        await conn.execute(text("""INSERT INTO product_eligibility_scopes
          (operator_test_id,scope_hash,payload) VALUES(:o,:s,CAST(:p AS jsonb))
          ON CONFLICT DO NOTHING"""), args | {"p": self._json(request.scope)})
        await conn.execute(text("""INSERT INTO product_eligibility_requests
          (operator_test_id,scope_hash,request_hash,feature21_context_hash,
          product_binding_hash,venue_binding_hash,payload)
          VALUES(:o,:s,:r,:c,:p,:v,CAST(:j AS jsonb))"""), args | {
          "r": request.request_hash, "c": request.feature21_context.binding_hash,
          "p": request.product.binding_hash, "v": request.venue.binding_hash,
          "j": self._json(request)})
        if failpoint == "after_request": raise RuntimeError("product_eligibility_injected_failure")
        await conn.execute(text("""INSERT INTO product_eligibility_decisions
          (operator_test_id,scope_hash,decision_hash,request_hash,expires_at,payload)
          VALUES(:o,:s,:d,:r,:e,CAST(:p AS jsonb))"""), args | {
          "d": decision.decision_hash, "r": request.request_hash,
          "e": decision.expires_at, "p": self._json(decision)})
        if failpoint == "after_decision": raise RuntimeError("product_eligibility_injected_failure")
        for leaf in decision.leaf_results:
            await conn.execute(text("""INSERT INTO product_eligibility_leaf_results
              (operator_test_id,scope_hash,decision_hash,jurisdiction_role,payload)
              VALUES(:o,:s,:d,:l,CAST(:p AS jsonb))"""), args | {
              "d": decision.decision_hash, "l": leaf.jurisdiction_role,
              "p": self._json(leaf)})
        await conn.execute(text("""INSERT INTO product_eligibility_test_center_bundles
          (operator_test_id,scope_hash,decision_hash,run_id,payload)
          VALUES(:o,:s,:d,:r,CAST(:p AS jsonb))"""), args | {
          "d": decision.decision_hash, "r": payload["runId"], "p": self._json(payload)})
        if failpoint == "after_bundle": raise RuntimeError("product_eligibility_injected_failure")

    async def read_claim(self, operator, idempotency_key, request_hash):
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""SELECT payload FROM product_eligibility_request_claims
              WHERE operator_test_id=:o AND idempotency_key=:k AND request_hash=:r"""),
              {"o": operator, "k": idempotency_key, "r": request_hash})).mappings().first()
            if not row: raise RuntimeError("product_eligibility_readback_missing")
            return dict(row["payload"])

    async def read_decision(self, operator, scope_hash, decision_hash):
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""SELECT payload FROM product_eligibility_decisions
              WHERE operator_test_id=:o AND scope_hash=:s AND decision_hash=:d"""),
              {"o": operator, "s": scope_hash, "d": decision_hash})).mappings().first()
            return dict(row["payload"]) if row else None
