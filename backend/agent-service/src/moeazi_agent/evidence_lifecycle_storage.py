from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .evidence_lifecycle_contracts import (
    CopyDispositionReceipt, PersistenceDecision, RetentionSchedule, TransformReceipt,
)
from .evidence_lifecycle_dispatch import EvidenceLifecycleDispatchRepository
from .evidence_lifecycle_deletion import digest
from .evidence_lifecycle_disposition import EvidenceLifecycleDispositionRepository
from .evidence_lifecycle_disclosure import EvidenceLifecycleDisclosureRepository
from .evidence_lifecycle_locking import lock_lifecycle_artifacts


class EvidenceLifecycleRepository(
        EvidenceLifecycleDispatchRepository, EvidenceLifecycleDisclosureRepository,
        EvidenceLifecycleDispositionRepository):
    def __init__(self, engine: AsyncEngine):
        self.engine = engine

    async def save_decision_bundle(self, decision: PersistenceDecision,
            receipts: list[TransformReceipt], schedule: RetentionSchedule | None) -> None:
        async with self.engine.begin() as conn:
            await self._save_bundle(conn, decision, receipts, schedule)

    async def _save_bundle(self, conn, decision: PersistenceDecision,
            receipts: list[TransformReceipt], schedule: RetentionSchedule | None, *,
            acquire_lock: bool = True) -> None:
        if schedule:
            if decision.retention_schedule_hash != schedule.schedule_hash \
                    or decision.scope.key != schedule.scope_key \
                    or decision.policy_hash != schedule.policy_hash:
                raise RuntimeError("Lifecycle decision and schedule binding is invalid")
            if acquire_lock:
                await lock_lifecycle_artifacts(
                    conn, schedule.scope_key, [schedule.artifact_id])
        elif decision.retention_schedule_hash is not None:
            raise RuntimeError("Lifecycle decision schedule is unavailable")
        inserted = (await conn.execute(text("""
            INSERT INTO evidence_lifecycle_decisions
              (decision_id,idempotency_key,input_digest,decision_hash,producer,purpose,sink,
               scope_kind,scope_key,policy_hash,inventory_hash,outcome,reasons,evaluated_at,
               expires_at,admitted_payload_hash,payload)
            VALUES (:id,:key,:input,:hash,:producer,:purpose,:sink,:scopeKind,:scopeKey,
              :policy,:inventory,:outcome,CAST(:reasons AS jsonb),:evaluated,:expires,:admitted,
              CAST(:payload AS jsonb))
            ON CONFLICT (producer,sink,scope_key,idempotency_key) DO NOTHING
            RETURNING decision_hash,input_digest
        """), {"id": decision.decision_id, "key": decision.idempotency_key,
            "input": decision.input_digest, "hash": decision.decision_hash,
            "producer": decision.producer, "purpose": decision.purpose, "sink": decision.sink,
            "scopeKind": decision.scope.kind, "scopeKey": decision.scope.key,
            "policy": decision.policy_hash, "inventory": decision.inventory_hash,
            "outcome": decision.outcome, "reasons": json.dumps(decision.reasons),
            "evaluated": decision.evaluated_at, "expires": decision.expires_at,
            "admitted": decision.sanitized_payload_hash,
            "payload": decision.model_dump_json()})).first()
        if not inserted:
            existing = (await conn.execute(text("""
                SELECT decision_hash,input_digest FROM evidence_lifecycle_decisions
                WHERE producer=:producer AND sink=:sink AND scope_key=:scopeKey
                  AND idempotency_key=:key
            """), {"producer": decision.producer, "sink": decision.sink,
                "key": decision.idempotency_key,
                "scopeKey": decision.scope.key})).first()
            if not existing or existing.decision_hash != decision.decision_hash \
                    or existing.input_digest != decision.input_digest:
                raise RuntimeError("Evidence lifecycle idempotency conflict")
            return
        for receipt in receipts:
            await conn.execute(text("""
                INSERT INTO evidence_transform_receipts
                  (receipt_id,decision_id,receipt_hash,path,data_class,outcome,payload)
                VALUES (:id,:decision,:hash,:path,:class,:outcome,CAST(:payload AS jsonb))
                ON CONFLICT (receipt_hash) DO NOTHING
            """), {"id": receipt.receipt_id, "decision": decision.decision_id,
                "hash": receipt.receipt_hash, "path": receipt.path,
                "class": receipt.data_class.value, "outcome": receipt.outcome,
                "payload": receipt.model_dump_json()})
        if schedule:
            await conn.execute(text("""
                INSERT INTO evidence_retention_schedules
                  (schedule_id,artifact_id,scope_key,policy_hash,schedule_hash,body_expires_at,
                   expected_copies,payload)
                VALUES (:id,:artifact,:scope,:policy,:hash,:expires,CAST(:copies AS jsonb),
                  CAST(:payload AS jsonb)) ON CONFLICT (schedule_hash) DO NOTHING
            """), {"id": schedule.schedule_id, "artifact": schedule.artifact_id,
                "scope": schedule.scope_key,
                "policy": schedule.policy_hash, "hash": schedule.schedule_hash,
                "expires": schedule.body_expires_at,
                "copies": json.dumps(schedule.expected_copies),
                "payload": schedule.model_dump_json()})
            await conn.execute(text("""
                INSERT INTO evidence_lifecycle_outbox
                  (schedule_hash,artifact_id,scope_key,due_at,expected_copies)
                VALUES (:hash,:artifact,:scope,:expires,CAST(:copies AS jsonb))
                ON CONFLICT (schedule_hash) DO NOTHING
            """), {"hash": schedule.schedule_hash, "artifact": schedule.artifact_id,
                "scope": schedule.scope_key,
                "expires": schedule.body_expires_at,
                "copies": json.dumps(schedule.expected_copies)})

    async def save_governed_evidence(self, item, sanitized: dict,
            decision: PersistenceDecision, receipts: list[TransformReceipt],
            schedule: RetentionSchedule) -> None:
        if decision.outcome not in {"allow", "transformed"}:
            raise RuntimeError("Blocked lifecycle decision cannot persist evidence")
        async with self.engine.begin() as conn:
            await self._save_bundle(conn, decision, receipts, schedule)
            await conn.execute(text("""
                INSERT INTO evidence
                  (evidence_id,source,reference,observed_at,event_at,quality_score,
                   content_hash,sanitized_content,provenance,lifecycle_decision_hash,
                   lifecycle_policy_hash,lifecycle_state,body_expires_at)
                VALUES (:id,:source,:reference,:observed,:event,:quality,:hash,:content,
                  CAST(:provenance AS jsonb),:decision,:policy,'governed',:expires)
                ON CONFLICT (evidence_id) DO NOTHING
            """), {"id": sanitized["evidence_id"], "source": sanitized["source"],
                "reference": sanitized.get("reference", "dropped"),
                "observed": item.ref.observed_at, "event": item.ref.event_at,
                "quality": item.ref.quality_score, "hash": sanitized["content_hash"],
                "content": sanitized["content"],
                "provenance": json.dumps({"market": sanitized["market"]}),
                "decision": decision.decision_hash, "policy": decision.policy_hash,
                "expires": schedule.body_expires_at})

    async def pending_outbox(self, limit: int = 50) -> list[dict]:
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("""
                SELECT schedule_hash,artifact_id,scope_key,due_at,expected_copies
                FROM evidence_lifecycle_outbox
                WHERE dispatched_at IS NULL AND available_at<=now()
                ORDER BY created_at LIMIT :limit
            """), {"limit": max(1, min(100, limit))})
            return [dict(row._mapping) for row in rows]

    async def mark_outbox(self, schedule_hash: str, scope_key: str, success: bool) -> None:
        async with self.engine.begin() as conn:
            artifact_id = (await conn.execute(text("""
                SELECT artifact_id FROM evidence_lifecycle_outbox
                WHERE schedule_hash=:hash AND scope_key=:scope
            """), {"hash": schedule_hash, "scope": scope_key})).scalar_one_or_none()
            if not artifact_id:
                raise RuntimeError("Evidence lifecycle outbox is unavailable")
            await lock_lifecycle_artifacts(conn, scope_key, [artifact_id])
            await conn.execute(text("""
                UPDATE evidence_lifecycle_outbox SET attempts=attempts+1,
                  dispatched_at=CASE WHEN :success THEN now() ELSE NULL END,
                  available_at=CASE WHEN :success THEN available_at ELSE now()+interval '10 seconds' END,
                  last_error_code=CASE WHEN :success THEN NULL ELSE 'temporal_start_failed' END
                WHERE schedule_hash=:hash AND scope_key=:scope AND dispatched_at IS NULL
            """), {"hash": schedule_hash, "scope": scope_key, "success": success})

    async def append_copy_receipt(self, payload: dict) -> None:
        receipt = CopyDispositionReceipt.model_validate(payload)
        body = receipt.model_dump(mode="json", exclude={"receipt_id", "receipt_hash"})
        if digest(body) != receipt.receipt_hash or receipt.receipt_id != f"ecd_{receipt.receipt_hash[:48]}":
            raise RuntimeError("Evidence copy receipt hash is invalid")
        payload = receipt.model_dump(mode="json")
        sql_values = receipt.model_dump()
        async with self.engine.begin() as conn:
            await lock_lifecycle_artifacts(
                conn, receipt.scope_key, [receipt.artifact_id])
            duplicate = (await conn.execute(text("""
                SELECT payload FROM evidence_copy_receipts
                WHERE receipt_hash=:receipt_hash AND scope_key=:scope_key
            """), payload)).scalar_one_or_none()
            if duplicate is not None:
                if duplicate != payload:
                    raise RuntimeError("Evidence copy receipt hash conflict")
                return
            current = (await conn.execute(text("""
                SELECT revision,receipt_hash FROM evidence_copy_receipts
                WHERE artifact_id=:artifact_id AND scope_key=:scope_key
                  AND schedule_hash=:schedule_hash AND copy_id=:copy_id
                ORDER BY revision DESC LIMIT 1
            """), payload)).first()
            expected_revision = 1 if not current else current.revision + 1
            expected_predecessor = None if not current else current.receipt_hash
            if payload["revision"] != expected_revision or payload["predecessor_hash"] != expected_predecessor:
                raise RuntimeError("Evidence copy receipt sequence conflict")
            await conn.execute(text("""
                INSERT INTO evidence_copy_receipts
                  (receipt_id,artifact_id,scope_key,schedule_hash,copy_id,owner_id,revision,predecessor_hash,
                   receipt_hash,status,observed_at,payload)
                VALUES (:receipt_id,:artifact_id,:scope_key,:schedule_hash,:copy_id,:owner_id,:revision,
                  :predecessor_hash,:receipt_hash,:status,:observed_at,CAST(:body AS jsonb))
            """), {**sql_values,
                "body": json.dumps(payload, sort_keys=True, default=str)})

    async def save_hold(self, hold) -> None:
        async with self.engine.begin() as conn:
            await lock_lifecycle_artifacts(conn, hold.scope_key, [hold.artifact_id])
            await conn.execute(text("""
                INSERT INTO evidence_lifecycle_holds
                  (hold_id,artifact_id,scope_key,revision,hold_hash,starts_at,expires_at,payload)
                VALUES (:id,:artifact,:scope,:revision,:hash,:starts,:expires,CAST(:payload AS jsonb))
                ON CONFLICT (hold_hash) DO NOTHING
            """), {"id": hold.hold_id, "artifact": hold.artifact_id,
                "scope": hold.scope_key,
                "revision": hold.revision, "hash": hold.hold_hash,
                "starts": hold.starts_at, "expires": hold.expires_at,
                "payload": hold.model_dump_json()})
