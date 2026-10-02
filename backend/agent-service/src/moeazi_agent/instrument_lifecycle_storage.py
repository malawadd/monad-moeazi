"""Timescale-only immutable fixture persistence for Feature 07."""
from __future__ import annotations

import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .instrument_lifecycle_contracts import InstrumentOperationDecision


def storage_scope(decision: InstrumentOperationDecision) -> str:
    """Keep account, venue, environment, and namespace in the durable key."""
    scope = decision.scope
    return ":".join((scope.account_id or "shared", scope.venue, scope.environment, scope.namespace))


def _same_payload(stored, value: dict) -> bool:
    return (json.loads(stored) if isinstance(stored, str) else stored) == value


class InstrumentLifecycleRepository:
    def __init__(self, engine: AsyncEngine): self.engine = engine

    async def persist(self, decision: InstrumentOperationDecision) -> None:
        value = decision.model_dump(mode="json")
        payload = json.dumps(value, sort_keys=True, separators=(",", ":"))
        scope_key = storage_scope(decision)
        async with self.engine.begin() as conn:
            result = await conn.execute(text("""INSERT INTO instrument_operation_decisions
                (decision_hash,tenant_id,scope_key,operation,outcome,idempotency_key,expires_at,payload)
                VALUES (:hash,:tenant,:scope,:operation,:outcome,:key,:expires,CAST(:payload AS jsonb))
                ON CONFLICT (tenant_id,scope_key,idempotency_key) DO NOTHING RETURNING decision_hash"""),
                {"hash": decision.decision_hash, "tenant": decision.scope.tenant_id, "scope": scope_key,
                 "operation": decision.operation, "outcome": decision.outcome, "key": decision.idempotency_key,
                 "expires": decision.expires_at, "payload": payload})
            if not result.first():
                previous = (await conn.execute(text("SELECT decision_hash,payload FROM instrument_operation_decisions WHERE tenant_id=:tenant AND scope_key=:scope AND idempotency_key=:key"),
                    {"tenant": decision.scope.tenant_id, "scope": scope_key, "key": decision.idempotency_key})).first()
                if not previous or previous.decision_hash != decision.decision_hash or not _same_payload(previous.payload, value):
                    raise RuntimeError("instrument decision idempotency conflict")
