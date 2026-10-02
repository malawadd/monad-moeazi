from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy import text

from .evidence_lifecycle_contracts import (
    PersistenceDecision, RetentionSchedule, TransformReceipt,
)
from .evidence_lifecycle_identity import canonical_lifecycle_scope_key
from .evidence_lifecycle_locking import lock_lifecycle_artifacts
from .evidence_lifecycle_trace_disclosure import load_disclosable_trace_events


class EvidenceLifecycleDisclosureRepository:
    async def save_operation(self, operation: str, receipt_id: str, artifact_id: str,
            scope_key: str, receipt_hash: str, payload: dict, *,
            idempotency_key: str, request_hash: str) -> dict:
        if operation not in {"access", "export"} or set(payload) != {"receipt"}:
            raise ValueError("Access/export history accepts only a minimal receipt root")
        async with self.engine.begin() as conn:
            await lock_lifecycle_artifacts(conn, scope_key, [artifact_id])
            inserted = (await conn.execute(text("""
                INSERT INTO evidence_lifecycle_operation_receipts
                  (receipt_id,artifact_id,scope_key,operation,idempotency_key,request_hash,
                   receipt_hash,payload)
                VALUES (:id,:artifact,:scope,:operation,:key,:request,:hash,CAST(:payload AS jsonb))
                ON CONFLICT (scope_key,operation,idempotency_key) DO NOTHING
                RETURNING request_hash,payload
            """), {"id": receipt_id, "artifact": artifact_id, "scope": scope_key,
                "operation": operation, "key": idempotency_key,
                "request": request_hash, "hash": receipt_hash,
                "payload": json.dumps(payload, sort_keys=True, default=str)})).first()
            if inserted:
                return inserted.payload
            replay = await self._operation_replay(conn, operation, scope_key,
                idempotency_key, request_hash)
            return replay

    async def save_disclosure_operation(self, operation: str, receipt_id: str,
            artifact_id: str, scope_key: str, receipt_hash: str, payload: dict, *,
            idempotency_key: str, request_hash: str, observed_at: datetime,
            decision: PersistenceDecision, transforms: list[TransformReceipt],
            schedule: RetentionSchedule | None,
            source_artifact_ids: list[str] | None = None,
            source_trace_bindings: list[dict] | None = None) -> dict:
        if operation not in {"access", "export"} or set(payload) != {"receipt"}:
            raise ValueError("Disclosure history accepts only a minimal receipt root")
        scope_key = canonical_lifecycle_scope_key(scope_key)
        async with self.engine.begin() as conn:
            await self._assert_disclosable(conn, artifact_id, scope_key,
                operation, observed_at, source_artifact_ids)
            if source_trace_bindings is not None:
                await load_disclosable_trace_events(conn, artifact_id, scope_key,
                    observed_at, expected_bindings=source_trace_bindings,
                    acquire_lock=False)
            replay = await self._operation_replay(conn, operation, scope_key,
                idempotency_key, request_hash, required=False, lock=True)
            if replay is not None:
                return replay
            await self._save_bundle(conn, decision, transforms, schedule,
                acquire_lock=False)
            inserted = (await conn.execute(text("""
                INSERT INTO evidence_lifecycle_operation_receipts
                  (receipt_id,artifact_id,scope_key,operation,idempotency_key,request_hash,
                   receipt_hash,payload)
                VALUES (:id,:artifact,:scope,:operation,:key,:request,:hash,CAST(:payload AS jsonb))
                ON CONFLICT (scope_key,operation,idempotency_key) DO NOTHING
                RETURNING request_hash,payload
            """), {"id": receipt_id, "artifact": artifact_id, "scope": scope_key,
                "operation": operation, "key": idempotency_key,
                "request": request_hash, "hash": receipt_hash,
                "payload": json.dumps(payload, sort_keys=True, default=str)})).first()
            if inserted:
                return inserted.payload
            return await self._operation_replay(conn, operation, scope_key,
                idempotency_key, request_hash)

    async def _operation_replay(self, conn, operation: str, scope_key: str,
            idempotency_key: str, request_hash: str, *, required: bool = True,
            lock: bool = False) -> dict | None:
        values = {"scope": scope_key, "operation": operation, "key": idempotency_key}
        if lock:
            replay = (await conn.execute(text("""
                SELECT request_hash,payload FROM evidence_lifecycle_operation_receipts
                WHERE scope_key=:scope AND operation=:operation AND idempotency_key=:key
                FOR UPDATE
            """), values)).first()
        else:
            replay = (await conn.execute(text("""
                SELECT request_hash,payload FROM evidence_lifecycle_operation_receipts
                WHERE scope_key=:scope AND operation=:operation AND idempotency_key=:key
            """), values)).first()
        if not replay:
            if required:
                raise RuntimeError("Evidence lifecycle operation replay is unavailable")
            return None
        if replay.request_hash != request_hash:
            raise RuntimeError("Evidence lifecycle operation idempotency conflict")
        return replay.payload

    async def _assert_disclosable(self, conn, artifact_id: str, scope_key: str,
            operation: str, observed_at: datetime,
            source_artifact_ids: list[str] | None = None) -> None:
        canonical_lifecycle_scope_key(scope_key)
        account = scope_key.removeprefix("account:")
        await lock_lifecycle_artifacts(conn, scope_key,
            [artifact_id, *(source_artifact_ids or [])])
        if artifact_id == f"monitoring:runs:{account}" and operation == "access":
            if source_artifact_ids is None or len(source_artifact_ids) > 200:
                raise RuntimeError("Monitoring collection lifecycle binding is invalid")
            for source_id in sorted(set(source_artifact_ids)):
                await self._assert_single_artifact(conn, source_id, scope_key, observed_at)
            return
        ephemeral = ("monitoring:usage:", "monitoring:safety:")
        if operation == "access" and artifact_id.startswith(ephemeral):
            if artifact_id.rsplit(":", 1)[-1] != account:
                raise RuntimeError("Evidence disclosure scope is invalid")
            return
        await self._assert_single_artifact(conn, artifact_id, scope_key, observed_at)

    async def _assert_single_artifact(self, conn, artifact_id: str,
            scope_key: str, observed_at: datetime) -> None:
        result = await conn.execute(text("""
            SELECT a.body_expires_at,a.lifecycle_deleted_at,d.outcome,s.schedule_hash,
                   a.created_at
            FROM analysis_runs a JOIN evidence_lifecycle_decisions d
              ON d.decision_hash=a.lifecycle_decision_hash AND d.scope_key=:scope
            JOIN evidence_retention_schedules s ON s.schedule_hash=
              d.payload->>'retention_schedule_hash' AND s.scope_key=:scope
            WHERE a.analysis_id=:artifact AND a.scope_key=:scope
              AND a.account_id=:account
            ORDER BY a.created_at DESC LIMIT 2 FOR UPDATE OF a
        """), {"artifact": artifact_id, "scope": scope_key,
            "account": scope_key.removeprefix("account:")})
        states = list(result.all())
        if len(states) != 1:
            raise RuntimeError(
                "Evidence disclosure lifecycle state identity is ambiguous or unavailable")
        state = states[0]
        if not state.body_expires_at or state.body_expires_at <= observed_at \
                or state.lifecycle_deleted_at is not None \
                or state.outcome not in {"allow", "transformed"}:
            raise RuntimeError("Evidence disclosure lifecycle state is unavailable")
        blocked = (await conn.execute(text("""
            SELECT EXISTS (SELECT 1 FROM evidence_lifecycle_tombstones
                    WHERE artifact_id=:artifact AND scope_key=:scope)
              OR EXISTS (SELECT 1 FROM evidence_lifecycle_holds
                    WHERE artifact_id=:artifact AND scope_key=:scope
                      AND starts_at<=:observed AND expires_at>:observed)
              OR EXISTS (SELECT 1 FROM (SELECT DISTINCT ON (copy_id) copy_id,status
                  FROM evidence_copy_receipts WHERE artifact_id=:artifact
                    AND scope_key=:scope AND schedule_hash=:schedule
                  ORDER BY copy_id,revision DESC) latest WHERE status IN
                  ('partial','unverifiable','verified_logical','verified_physical','crypto_erased'))
              AS blocked
        """), {"artifact": artifact_id, "scope": scope_key,
            "schedule": state.schedule_hash, "observed": observed_at})).scalar_one()
        if blocked:
            raise RuntimeError("Evidence disclosure lifecycle state blocks access")

    async def stream_trace_body(self, artifact_id: str, event_id: str,
            event_created_at: datetime, lifecycle_decision_hash: str,
            scope_key: str, observed_at: datetime) -> str:
        """Return only the exact durable, hash-bound, currently disclosable body."""
        canonical_lifecycle_scope_key(scope_key)
        async with self.engine.begin() as conn:
            await lock_lifecycle_artifacts(conn, scope_key, [artifact_id])
            await self._assert_single_artifact(conn, artifact_id, scope_key, observed_at)
            events, _ = await load_disclosable_trace_events(conn, artifact_id,
                scope_key, observed_at, event_id=event_id,
                event_created_at=event_created_at,
                decision_hash=lifecycle_decision_hash, acquire_lock=False)
            return json.dumps(events[0], sort_keys=True, separators=(",", ":"), default=str)

    async def replay_operation(self, operation: str, scope_key: str,
            idempotency_key: str, request_hash: str) -> dict | None:
        async with self.engine.connect() as conn:
            return await self._operation_replay(conn, operation, scope_key,
                idempotency_key, request_hash, required=False)
