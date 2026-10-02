from __future__ import annotations

import json
from datetime import timedelta

from sqlalchemy import text

from .evidence_lifecycle_contracts import LifecycleHold
from .evidence_lifecycle_deletion import digest
from .evidence_lifecycle_identity import canonical_lifecycle_scope_key
from .evidence_lifecycle_locking import lock_lifecycle_artifacts


class EvidenceLifecycleHoldRepository:
    async def create_or_replay_hold(self, *, artifact_id: str, scope_key: str,
            reviewer_hash: str, reason_code: str, duration_seconds: int,
            idempotency_key: str, observed_at) -> LifecycleHold:
        async with self.engine.begin() as conn:
            scope_key = canonical_lifecycle_scope_key(scope_key)
            request_hash = digest({"artifact_id": artifact_id, "scope_key": scope_key,
                "reviewer_hash": reviewer_hash, "reason_code": reason_code,
                "duration_seconds": duration_seconds})
            await lock_lifecycle_artifacts(conn, scope_key, [artifact_id])
            replay = (await conn.execute(text("""
                SELECT request_hash,payload FROM evidence_lifecycle_operation_receipts
                WHERE operation='hold' AND scope_key=:scope AND idempotency_key=:key
            """), {"scope": scope_key, "key": idempotency_key})).first()
            if replay:
                if replay.request_hash != request_hash:
                    raise RuntimeError("Evidence lifecycle hold idempotency conflict")
                value = replay.payload if isinstance(replay.payload, dict) \
                    else json.loads(replay.payload)
                return LifecycleHold.model_validate(value["hold"])
            latest_payload = (await conn.execute(text("""
                SELECT payload FROM evidence_lifecycle_holds
                WHERE artifact_id=:artifact AND scope_key=:scope
                ORDER BY revision DESC LIMIT 1
            """), {"artifact": artifact_id, "scope": scope_key})).scalar_one_or_none()
            latest = LifecycleHold.model_validate(latest_payload) if latest_payload else None
            revision = latest.revision + 1 if latest else 1
            maximum = latest.max_expires_at if latest and latest.max_expires_at > observed_at \
                else observed_at + timedelta(days=7)
            expires = min(observed_at + timedelta(seconds=duration_seconds), maximum)
            body = {"artifact_id": artifact_id, "scope_key": scope_key,
                "reason_code": reason_code,
                "reviewer_hash": reviewer_hash, "starts_at": observed_at.isoformat(),
                "expires_at": expires.isoformat(), "max_expires_at": maximum.isoformat(),
                "revision": revision,
                "supersedes_hold_hash": latest.hold_hash if latest else None}
            hold_hash = digest(body)
            hold = LifecycleHold.model_validate({**body,
                "hold_id": f"elh_{hold_hash[:48]}", "hold_hash": hold_hash})
            operation = {"hold": hold.model_dump(mode="json")}
            await conn.execute(text("""
                INSERT INTO evidence_lifecycle_holds
                  (hold_id,artifact_id,scope_key,revision,hold_hash,starts_at,expires_at,payload)
                VALUES (:id,:artifact,:scope,:revision,:hash,:starts,:expires,CAST(:hold AS jsonb))
            """), {"id": hold.hold_id, "artifact": artifact_id, "scope": scope_key,
                "revision": revision,
                "hash": hold_hash, "starts": hold.starts_at, "expires": hold.expires_at,
                "hold": hold.model_dump_json()})
            await conn.execute(text("""
                INSERT INTO evidence_lifecycle_operation_receipts
                  (receipt_id,artifact_id,scope_key,operation,idempotency_key,request_hash,
                   receipt_hash,payload)
                VALUES (:id,:artifact,:scope,'hold',:key,:request,:hash,CAST(:payload AS jsonb))
                ON CONFLICT (scope_key,operation,idempotency_key) DO NOTHING
            """), {"id": hold.hold_id, "artifact": artifact_id, "scope": scope_key,
                "key": idempotency_key, "request": request_hash, "hash": hold_hash,
                "payload": json.dumps(operation, default=str, sort_keys=True)})
            await conn.execute(text("""
                INSERT INTO evidence_lifecycle_hold_outbox
                  (hold_hash,artifact_id,scope_key,due_at,available_at)
                VALUES (:hash,:artifact,:scope,:due,:due)
            """), {"hash": hold_hash, "artifact": artifact_id,
                "scope": scope_key, "due": hold.expires_at})
            return hold

    async def pending_hold_expiries(self, limit: int = 50) -> list[dict]:
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("""
                SELECT o.hold_hash,o.artifact_id,o.scope_key,o.due_at,h.revision
                FROM evidence_lifecycle_hold_outbox o
                JOIN evidence_lifecycle_holds h ON h.hold_hash=o.hold_hash
                  AND h.scope_key=o.scope_key
                WHERE o.dispatched_at IS NULL AND o.due_at<=now() AND o.available_at<=now()
                ORDER BY o.due_at LIMIT :limit
            """), {"limit": max(1, min(100, limit))})
            return [dict(row._mapping) for row in rows]

    async def prepare_hold_expiry(self, hold_hash: str, scope_key: str,
            observed_at) -> dict | None:
        async with self.engine.begin() as conn:
            artifact_id = (await conn.execute(text("""
                SELECT artifact_id FROM evidence_lifecycle_hold_outbox
                WHERE hold_hash=:hash AND scope_key=:scope
            """), {"hash": hold_hash, "scope": scope_key})).scalar_one_or_none()
            if not artifact_id:
                return None
            await lock_lifecycle_artifacts(conn, scope_key, [artifact_id])
            row = (await conn.execute(text("""
                SELECT o.artifact_id,o.scope_key,o.due_at,o.dispatched_at,o.transition_hash,
                       h.revision
                FROM evidence_lifecycle_hold_outbox o
                JOIN evidence_lifecycle_holds h ON h.hold_hash=o.hold_hash
                  AND h.scope_key=o.scope_key
                WHERE o.hold_hash=:hash AND o.scope_key=:scope FOR UPDATE
            """), {"hash": hold_hash, "scope": scope_key})).first()
            if not row or row.dispatched_at or observed_at < row.due_at:
                return None
            latest = (await conn.execute(text("""
                SELECT hold_hash,revision FROM evidence_lifecycle_holds
                WHERE artifact_id=:artifact AND scope_key=:scope
                ORDER BY revision DESC LIMIT 1
            """), {"artifact": row.artifact_id, "scope": row.scope_key})).first()
            state = "expired" if latest.hold_hash == hold_hash else "superseded"
            body = {"artifact_id": row.artifact_id, "scope_key": row.scope_key,
                "hold_hash": hold_hash, "hold_revision": row.revision, "state": state,
                "observed_at": row.due_at.isoformat()}
            transition_hash = digest(body)
            if row.transition_hash and row.transition_hash != transition_hash:
                raise RuntimeError("Hold expiry transition conflict")
            await conn.execute(text("""
                INSERT INTO evidence_lifecycle_operation_receipts
                  (receipt_id,artifact_id,scope_key,operation,idempotency_key,request_hash,
                   receipt_hash,payload)
                VALUES (:id,:artifact,:scope,'hold',:key,:receipt,:receipt,CAST(:payload AS jsonb))
                ON CONFLICT (receipt_hash) DO NOTHING
            """), {"id": f"ehe_{transition_hash[:48]}", "artifact": row.artifact_id,
                "scope": row.scope_key, "key": f"hold-expiry:{hold_hash}",
                "receipt": transition_hash, "payload": json.dumps(body, sort_keys=True)})
            await conn.execute(text("""
                UPDATE evidence_lifecycle_hold_outbox SET transition_hash=:transition
                WHERE hold_hash=:hash AND scope_key=:scope AND dispatched_at IS NULL
            """), {"hash": hold_hash, "scope": scope_key,
                "transition": transition_hash})
            return {**body, "transition_hash": transition_hash}

    async def ack_hold_expiry(self, hold_hash: str, scope_key: str,
            transition_hash: str, projected_at) -> None:
        async with self.engine.begin() as conn:
            artifact_id = (await conn.execute(text("""
                SELECT artifact_id FROM evidence_lifecycle_hold_outbox
                WHERE hold_hash=:hash AND scope_key=:scope
            """), {"hash": hold_hash, "scope": scope_key})).scalar_one_or_none()
            if not artifact_id:
                raise RuntimeError("Hold expiry acknowledgement is unavailable")
            await lock_lifecycle_artifacts(conn, scope_key, [artifact_id])
            result = await conn.execute(text("""
                UPDATE evidence_lifecycle_hold_outbox SET attempts=attempts+1,
                  projected_at=:at,dispatched_at=:at,last_error_code=NULL
                WHERE hold_hash=:hash AND scope_key=:scope
                  AND transition_hash=:transition AND dispatched_at IS NULL
            """), {"hash": hold_hash, "scope": scope_key,
                "transition": transition_hash, "at": projected_at})
            if result.rowcount != 1:
                raise RuntimeError("Hold expiry acknowledgement conflict")

    async def nack_hold_expiry(self, hold_hash: str, scope_key: str, transition_hash: str,
            observed_at, error_code: str) -> None:
        async with self.engine.begin() as conn:
            artifact_id = (await conn.execute(text("""
                SELECT artifact_id FROM evidence_lifecycle_hold_outbox
                WHERE hold_hash=:hash AND scope_key=:scope
            """), {"hash": hold_hash, "scope": scope_key})).scalar_one_or_none()
            if not artifact_id:
                raise RuntimeError("Hold expiry rejection is unavailable")
            await lock_lifecycle_artifacts(conn, scope_key, [artifact_id])
            await conn.execute(text("""
                UPDATE evidence_lifecycle_hold_outbox SET attempts=attempts+1,
                  available_at=now()+interval '10 seconds',last_error_code=:error
                WHERE hold_hash=:hash AND scope_key=:scope
                  AND transition_hash=:transition AND dispatched_at IS NULL
            """), {"hash": hold_hash, "scope": scope_key, "transition": transition_hash,
                "at": observed_at, "error": error_code[:80]})
