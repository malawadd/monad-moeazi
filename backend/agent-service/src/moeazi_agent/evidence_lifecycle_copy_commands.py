from __future__ import annotations

import json
from datetime import timedelta

from sqlalchemy import text

from .evidence_lifecycle_contracts import CopyDispositionReceipt
from .evidence_lifecycle_deletion import LifecycleCommand, aggregate_deletion, digest
from .evidence_lifecycle_registry import policy_by_hash
from .evidence_lifecycle_identity import evidence_cache_key
from .evidence_lifecycle_locking import lock_lifecycle_artifacts


TERMINAL_COPY_STATES = frozenset({
    "verified_logical", "not_applicable", "unverifiable", "public_onchain",
})


class EvidenceLifecycleCopyCommandRepository:
    """Durable owner commands; workflow memory is never deletion evidence."""

    async def issue_copy_commands(self, conn, *, artifact_id: str, schedule: dict,
            inventory: dict[str, str], receipts: list[CopyDispositionReceipt], observed_at) -> None:
        schedule_hash = schedule["schedule_hash"]
        scope_key = schedule["scope_key"]
        terminal = {item.copy_id for item in receipts
            if item.scope_key == scope_key and item.schedule_hash == schedule_hash
            and item.status in TERMINAL_COPY_STATES}
        for copy_id, owner_id in sorted(inventory.items()):
            if copy_id in terminal:
                continue
            locator = None
            if copy_id == "redis.evidence_cache":
                market = (await conn.execute(text("""
                    SELECT provenance->>'market' FROM evidence WHERE evidence_id=:artifact
                """), {"artifact": artifact_id})).scalar_one_or_none()
                if market:
                    locator = evidence_cache_key(str(market), artifact_id)
            body = {"artifact_id": artifact_id, "scope_key": scope_key,
                "schedule_hash": schedule_hash,
                "owner_id": owner_id, "copy_id": copy_id,
                "action": "delete_copy", "revision": 1,
                "policy_hash": schedule["policy_hash"], "reason_code": "retention_due",
                "idempotency_key": f"copy:{schedule_hash}:{copy_id}", "locator": locator,
                "issued_at": observed_at.isoformat()}
            command_hash = digest(body)
            command = LifecycleCommand.model_validate({**body,
                "command_id": f"elc_{command_hash[:48]}", "command_hash": command_hash})
            await conn.execute(text("""
                INSERT INTO evidence_lifecycle_commands
                  (command_id,artifact_id,scope_key,schedule_hash,owner_id,copy_id,revision,command_hash,
                   idempotency_key,payload)
                VALUES (:command_id,:artifact_id,:scope_key,:schedule_hash,:owner_id,:copy_id,:revision,:command_hash,
                  :idempotency_key,CAST(:payload AS jsonb))
                ON CONFLICT (command_hash) DO NOTHING
            """), {**command.model_dump(mode="json"), "payload": command.model_dump_json()})
            await conn.execute(text("""
                INSERT INTO evidence_lifecycle_command_outbox
                  (command_hash,command_id,artifact_id,scope_key,schedule_hash,copy_id,owner_id)
                VALUES (:hash,:id,:artifact,:scope,:schedule,:copy,:owner)
                ON CONFLICT (scope_key,artifact_id,schedule_hash,copy_id) DO NOTHING
            """), {"hash": command_hash, "id": command.command_id,
                "artifact": artifact_id, "scope": scope_key, "schedule": schedule_hash,
                "copy": copy_id, "owner": owner_id})

    async def pending_copy_commands(self, schedule_hash: str, scope_key: str,
            limit: int = 20) -> list[dict]:
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("""
                SELECT o.command_hash,o.command_id,o.artifact_id,o.scope_key,o.schedule_hash,o.copy_id,
                       o.owner_id,o.attempts,c.payload
                FROM evidence_lifecycle_command_outbox o
                JOIN evidence_lifecycle_commands c ON c.command_hash=o.command_hash
                WHERE o.schedule_hash=:schedule AND o.scope_key=:scope
                  AND c.scope_key=:scope AND o.completed_at IS NULL
                  AND o.available_at<=now()
                ORDER BY o.copy_id LIMIT :limit
            """), {"schedule": schedule_hash, "scope": scope_key,
                "limit": max(1, min(50, limit))})
            return [dict(row._mapping) for row in rows]

    async def evidence_cache_locator(self, artifact_id: str,
            schedule_hash: str, scope_key: str) -> str | None:
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT e.provenance->>'market' AS market,s.policy_hash
                FROM evidence_retention_schedules s
                LEFT JOIN evidence e ON e.evidence_id=s.artifact_id
                WHERE s.artifact_id=:artifact AND s.schedule_hash=:schedule
                  AND s.scope_key=:scope
            """), {"artifact": artifact_id, "schedule": schedule_hash,
                "scope": scope_key})).first()
        policy = policy_by_hash(row.policy_hash) if row else None
        if not row or not row.market or not policy \
                or "redis.evidence_cache" not in policy.expected_copies:
            return None
        return evidence_cache_key(str(row.market), artifact_id)

    async def complete_copy_command(self, command_hash: str, status: str,
            observed_at, evidence_reference: str, scope_key: str) -> CopyDispositionReceipt:
        if status not in TERMINAL_COPY_STATES:
            raise ValueError("Copy command terminal status is invalid")
        async with self.engine.begin() as conn:
            artifact_id = (await conn.execute(text("""
                SELECT artifact_id FROM evidence_lifecycle_command_outbox
                WHERE command_hash=:hash AND scope_key=:scope
            """), {"hash": command_hash, "scope": scope_key})).scalar_one_or_none()
            if not artifact_id:
                raise RuntimeError("Copy command is unavailable")
            await lock_lifecycle_artifacts(conn, scope_key, [artifact_id])
            row = (await conn.execute(text("""
                SELECT o.completed_at,o.receipt_hash,o.scope_key,o.schedule_hash,c.payload
                FROM evidence_lifecycle_command_outbox o
                JOIN evidence_lifecycle_commands c ON c.command_hash=o.command_hash
                WHERE o.command_hash=:hash AND o.scope_key=:scope
                  AND c.scope_key=:scope
            """), {"hash": command_hash, "scope": scope_key})).first()
            if not row:
                raise RuntimeError("Copy command is unavailable")
            command = LifecycleCommand.model_validate(row.payload)
            if command.schedule_hash != row.schedule_hash or command.scope_key != row.scope_key:
                raise RuntimeError("Copy command schedule binding is invalid")
            if row.completed_at:
                payload = (await conn.execute(text("""
                    SELECT payload FROM evidence_copy_receipts
                    WHERE receipt_hash=:hash AND scope_key=:scope
                """), {"hash": row.receipt_hash, "scope": scope_key})).scalar_one()
                return CopyDispositionReceipt.model_validate(payload)
            current = (await conn.execute(text("""
                SELECT revision,receipt_hash FROM evidence_copy_receipts
                WHERE artifact_id=:artifact AND scope_key=:scope
                  AND schedule_hash=:schedule AND copy_id=:copy
                ORDER BY revision DESC LIMIT 1 FOR UPDATE
            """), {"artifact": command.artifact_id, "scope": command.scope_key,
                "schedule": command.schedule_hash,
                "copy": command.copy_id})).first()
            body = {"artifact_id": command.artifact_id, "scope_key": command.scope_key,
                "schedule_hash": command.schedule_hash, "copy_id": command.copy_id,
                "owner_id": command.owner_id, "revision": current.revision + 1 if current else 1,
                "predecessor_hash": current.receipt_hash if current else None,
                "status": status, "evidence_reference": evidence_reference,
                "observed_at": observed_at.isoformat()}
            receipt_hash = digest(body)
            receipt = CopyDispositionReceipt.model_validate({**body,
                "receipt_id": f"ecd_{receipt_hash[:48]}", "receipt_hash": receipt_hash})
            await conn.execute(text("""
                INSERT INTO evidence_copy_receipts
                  (receipt_id,artifact_id,scope_key,schedule_hash,copy_id,owner_id,revision,predecessor_hash,
                   receipt_hash,status,observed_at,payload)
                VALUES (:receipt_id,:artifact_id,:scope_key,:schedule_hash,:copy_id,:owner_id,:revision,:predecessor_hash,
                  :receipt_hash,:status,:observed_at,CAST(:payload AS jsonb))
            """), {**receipt.model_dump(), "payload": receipt.model_dump_json()})
            await conn.execute(text("""
                UPDATE evidence_lifecycle_command_outbox SET attempts=attempts+1,
                  completed_at=:at,terminal_status=:status,receipt_hash=:receipt,
                  last_error_code=NULL WHERE command_hash=:hash AND scope_key=:scope
                    AND completed_at IS NULL
            """), {"hash": command_hash, "at": observed_at,
                "scope": scope_key, "status": status, "receipt": receipt_hash})
            return receipt

    async def fail_copy_command(self, command_hash: str, observed_at,
            error_code: str, scope_key: str) -> bool:
        async with self.engine.begin() as conn:
            artifact_id = (await conn.execute(text("""
                SELECT artifact_id FROM evidence_lifecycle_command_outbox
                WHERE command_hash=:hash AND scope_key=:scope
            """), {"hash": command_hash, "scope": scope_key})).scalar_one_or_none()
            if not artifact_id:
                raise RuntimeError("Copy command is unavailable")
            await lock_lifecycle_artifacts(conn, scope_key, [artifact_id])
            row = (await conn.execute(text("""
                UPDATE evidence_lifecycle_command_outbox SET attempts=attempts+1,
                  available_at=now()+interval '10 seconds',last_error_code=:error
                WHERE command_hash=:hash AND scope_key=:scope AND completed_at IS NULL
                RETURNING attempts
            """), {"hash": command_hash, "scope": scope_key, "at": observed_at,
                "error": error_code[:80]})).first()
        return bool(row and row.attempts >= 3)

    async def aggregate_schedule(self, artifact_id: str, schedule_hash: str,
            observed_at, scope_key: str) -> dict:
        async with self.engine.connect() as conn:
            schedule = (await conn.execute(text("""
                SELECT policy_hash,scope_key FROM evidence_retention_schedules
                WHERE artifact_id=:artifact AND schedule_hash=:schedule AND scope_key=:scope
            """), {"artifact": artifact_id, "schedule": schedule_hash,
                "scope": scope_key})).first()
            if not schedule or not policy_by_hash(schedule.policy_hash):
                raise RuntimeError("Copy command schedule is unavailable")
            rows = await conn.execute(text("""
                SELECT payload FROM evidence_copy_receipts
                WHERE artifact_id=:artifact AND scope_key=:scope AND schedule_hash=:schedule
                ORDER BY copy_id,revision
            """), {"artifact": artifact_id, "scope": schedule.scope_key,
                "schedule": schedule_hash})
            receipts = [CopyDispositionReceipt.model_validate(row.payload) for row in rows]
        return aggregate_deletion(artifact_id, schedule.policy_hash, schedule_hash, receipts,
            observed_at, schedule.scope_key).model_dump(mode="json")
