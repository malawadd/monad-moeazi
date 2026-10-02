"""Transactional append-only storage for the isolated usage-rights fixture.

This repository accepts only canonical, already-evaluated artifacts. It never
evaluates rights and never exposes an external operation.
"""
from __future__ import annotations

import json
from sqlalchemy import text


class UsageRightsConflict(RuntimeError):
    """A durable idempotency collision (the API maps this to HTTP 409)."""


class UsageRightsRepository:
    def __init__(self, engine):
        self.engine = engine

    @staticmethod
    def _json(value):
        if hasattr(value, "model_dump"):
            value = value.model_dump(mode="json")
        return json.dumps(value, sort_keys=True, separators=(",", ":"))

    async def persist(self, operator, idempotency_key, request_hash, scope,
                      request, decision, payload, *, failpoint=None, save_generic=False):
        """Atomically write claim, immutable graph, bundle, and read it back."""
        conflict = False
        async with self.engine.begin() as conn:
            await conn.execute(text("SELECT pg_advisory_xact_lock(hashtext(:v))"), {
                "v": f"usage-rights:{operator}:{idempotency_key}"})
            claim = (await conn.execute(text("""
                SELECT request_hash,payload FROM usage_rights_request_claims
                WHERE operator_test_id=:o AND idempotency_key=:k FOR UPDATE
            """), {"o": operator, "k": idempotency_key})).mappings().first()
            if claim:
                if claim["request_hash"] == request_hash:
                    return dict(claim["payload"])
                await conn.execute(text("""
                    INSERT INTO usage_rights_conflicts
                    (operator_test_id,idempotency_key,request_hash,payload)
                    VALUES(:o,:k,:r,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING
                """), {"o": operator, "k": idempotency_key, "r": request_hash,
                       "p": self._json({"code": "IDEMPOTENCY_CONFLICT"})})
                conflict = True
            else:
                await self._write_graph(conn, operator, scope.scope_hash, request,
                                        decision, payload, failpoint)
                if save_generic:
                    from .test_center_storage import save_run_on_connection
                    await save_run_on_connection(conn, payload)
                await conn.execute(text("""
                    INSERT INTO usage_rights_request_claims
                    (operator_test_id,idempotency_key,request_hash,payload)
                    VALUES(:o,:k,:r,CAST(:p AS jsonb))
                """), {"o": operator, "k": idempotency_key, "r": request_hash,
                       "p": self._json(payload)})
        if conflict:
            raise UsageRightsConflict("usage_rights_idempotency_conflict")
        return await self.read_claim(operator, idempotency_key, request_hash)

    async def _write_graph(self, conn, operator, scope_hash, request, decision,
                           payload, failpoint):
        args = {"o": operator, "s": scope_hash}
        await conn.execute(text("""
            INSERT INTO usage_rights_scopes(operator_test_id,scope_hash,payload)
            VALUES(:o,:s,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING
        """), args | {"p": self._json(request.scope)})
        await conn.execute(text("""
            INSERT INTO usage_rights_operation_requests
            (operator_test_id,scope_hash,request_hash,payload)
            VALUES(:o,:s,:r,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING
        """), args | {"r": request.request_hash, "p": self._json(request)})
        if failpoint == "after_request":
            raise RuntimeError("usage_rights_injected_failure")
        await conn.execute(text("""
            INSERT INTO usage_rights_decisions
            (operator_test_id,scope_hash,decision_hash,request_hash,predecessor_hash,
             expires_at,payload) VALUES(:o,:s,:d,:r,:h,:e,CAST(:p AS jsonb))
        """), args | {"d": decision.decision_hash, "r": request.request_hash,
                       "h": decision.predecessor_decision_hash,
                       "e": decision.expires_at, "p": self._json(decision)})
        for match in decision.leaf_matches:
            await conn.execute(text("""
                INSERT INTO usage_rights_leaf_matches
                (operator_test_id,scope_hash,decision_hash,leaf_id,assertion_hash,payload)
                VALUES(:o,:s,:d,:l,:a,CAST(:p AS jsonb))
            """), args | {"d": decision.decision_hash, "l": match.leaf_id,
                           "a": match.assertion_hash, "p": self._json(match)})
        for obligation in decision.required_obligations:
            await conn.execute(text("""
                INSERT INTO usage_rights_obligation_requirements
                (operator_test_id,scope_hash,decision_hash,obligation)
                VALUES(:o,:s,:d,:b)
            """), args | {"d": decision.decision_hash, "b": obligation})
        await conn.execute(text("""
            INSERT INTO usage_rights_test_center_bundles
            (operator_test_id,scope_hash,decision_hash,run_id,payload)
            VALUES(:o,:s,:d,:r,CAST(:p AS jsonb))
        """), args | {"d": decision.decision_hash,
                       "r": payload.get("runId", "fixture-run"),
                       "p": self._json(payload)})
        if failpoint == "before_claim":
            raise RuntimeError("usage_rights_injected_failure")

    async def read_claim(self, operator, idempotency_key, request_hash):
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT payload FROM usage_rights_request_claims
                WHERE operator_test_id=:o AND idempotency_key=:k AND request_hash=:r
            """), {"o": operator, "k": idempotency_key, "r": request_hash})).mappings().first()
            if not row:
                raise RuntimeError("usage_rights_readback_missing")
            return dict(row["payload"])

    async def read_decision(self, operator, scope_hash, decision_hash):
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT payload FROM usage_rights_decisions WHERE operator_test_id=:o
                AND scope_hash=:s AND decision_hash=:d
            """), {"o": operator, "s": scope_hash, "d": decision_hash})).mappings().first()
            return dict(row["payload"]) if row else None
