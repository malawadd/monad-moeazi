"""Bounded transactional outbox claiming; network delivery belongs to the caller."""
from __future__ import annotations

from uuid import uuid4

from sqlalchemy import text

from .finance_contracts import FinanceError


class FinanceOutboxMixin:
    async def claim_outbox(self, *, limit: int = 20,
                           lease_seconds: int = 30) -> list[dict]:
        if not 1 <= limit <= 100 or not 1 <= lease_seconds <= 300:
            raise FinanceError("invalid outbox claim bounds")
        delivery_id = str(uuid4())
        async with self.engine.begin() as conn:
            rows = (await conn.execute(text("""
                WITH pending AS (
                  SELECT environment,scope_id,strategy_account_id,account_revision
                  FROM finance_outbox
                  WHERE published_at IS NULL
                    AND (claimed_until IS NULL OR claimed_until <= clock_timestamp())
                  ORDER BY created_at,event_id LIMIT :limit FOR UPDATE SKIP LOCKED
                )
                UPDATE finance_outbox o SET claim_id=:delivery_id,
                  claimed_until=clock_timestamp()+make_interval(secs=>:seconds),
                  attempts=attempts+1
                FROM pending p WHERE o.environment=p.environment AND o.scope_id=p.scope_id
                  AND o.strategy_account_id=p.strategy_account_id
                  AND o.account_revision=p.account_revision
                RETURNING o.event_id,o.payload_hash,o.payload,o.account_revision,
                  o.environment,o.scope_id,o.strategy_account_id
            """), {"delivery_id": delivery_id, "seconds": lease_seconds,
                   "limit": limit})).mappings().all()
            return [{"eventId": row["event_id"], "payloadHash": row["payload_hash"],
                     "payload": row["payload"], "accountRevision": str(row["account_revision"]),
                     "environment": row["environment"], "scopeId": row["scope_id"],
                     "strategyAccountId": row["strategy_account_id"]} for row in rows]

    async def ack_outbox(self, event_id: str, payload_hash: str) -> bool:
        if not event_id or len(payload_hash) != 64:
            raise FinanceError("invalid outbox acknowledgment")
        async with self.engine.begin() as conn:
            row = (await conn.execute(text("""
                SELECT payload_hash,published_at
                FROM finance_outbox WHERE event_id=:event_id FOR UPDATE
            """), {"event_id": event_id})).mappings().first()
            if row is None or row["payload_hash"] != payload_hash:
                raise FinanceError("outbox event or payload hash mismatch")
            if row["published_at"] is not None:
                return True
            await conn.execute(text("""
                UPDATE finance_outbox SET published_at=clock_timestamp(),
                  claim_id=NULL,claimed_until=NULL WHERE event_id=:event_id
            """), {"event_id": event_id})
            return True
