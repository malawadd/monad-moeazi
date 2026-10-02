from __future__ import annotations

import json

from sqlalchemy import text

from .evidence_lifecycle_contracts import CopyDispositionReceipt
from .evidence_lifecycle_deletion import (
    LifecycleTombstone, aggregate_deletion, digest,
)
from .evidence_lifecycle_registry import inventory_for, policy_by_hash
from .evidence_lifecycle_copy_commands import EvidenceLifecycleCopyCommandRepository
from .evidence_lifecycle_holds import EvidenceLifecycleHoldRepository
from .evidence_lifecycle_identity import canonical_lifecycle_scope_key
from .evidence_lifecycle_locking import lock_lifecycle_artifacts


class EvidenceLifecycleDispositionRepository(
        EvidenceLifecycleCopyCommandRepository, EvidenceLifecycleHoldRepository):
    """Atomic local body disposition with conservative copy accounting."""

    async def expire_artifact_body(self, artifact_id: str, now, force: bool = False,
            schedule_hash: str | None = None, scope_key: str = "public") -> bool:
        result = await self.dispose_artifact(artifact_id, now, force=force,
            schedule_hash=schedule_hash, scope_key=scope_key)
        return bool(result.get("deleted"))

    async def dispose_artifact(self, artifact_id: str, observed_at, *, force: bool = False,
            schedule_hash: str | None = None, scope_key: str | None = None,
            idempotency_key: str | None = None) -> dict:
        scope_key = canonical_lifecycle_scope_key(scope_key or "public")
        async with self.engine.begin() as conn:
            await lock_lifecycle_artifacts(conn, scope_key, [artifact_id])
            request_hash = digest({"artifact_id": artifact_id, "scope_key": scope_key,
                "schedule_hash": schedule_hash, "force": force})
            if idempotency_key:
                replay = (await conn.execute(text("""
                    SELECT request_hash,payload FROM evidence_lifecycle_operation_receipts
                    WHERE operation='delete' AND scope_key=:scope
                      AND idempotency_key=:key
                """), {"scope": scope_key, "key": idempotency_key})).first()
                if replay:
                    if replay.request_hash != request_hash:
                        raise RuntimeError("Evidence lifecycle delete idempotency conflict")
                    return replay.payload if isinstance(replay.payload, dict) \
                        else json.loads(replay.payload)
            held = (await conn.execute(text("""
                SELECT 1 FROM evidence_lifecycle_holds WHERE artifact_id=:artifact
                  AND scope_key=:scope AND starts_at<=:now AND expires_at>:now LIMIT 1
            """), {"artifact": artifact_id, "scope": scope_key, "now": observed_at})).first()
            schedule = await self._schedule(conn, artifact_id, scope_key, schedule_hash)
            if not schedule:
                result = {"artifact_id": artifact_id, "deleted": False,
                    "outcome": "blocked", "reason_codes": ["inventory_unknown"],
                    "idempotency_key": idempotency_key}
                return await self._record_delete_operation(conn, result, artifact_id,
                    scope_key, idempotency_key, request_hash)
            policy = policy_by_hash(schedule["policy_hash"])
            if not policy:
                result = {"artifact_id": artifact_id, "deleted": False,
                    "outcome": "blocked", "reason_codes": ["inventory_unknown"],
                    "idempotency_key": idempotency_key}
                return await self._record_delete_operation(conn, result, artifact_id,
                    scope_key, idempotency_key, request_hash)
            changed = 0 if held else await self._clear_body(
                conn, policy.sink, policy.policy_hash, schedule["body_expires_at"],
                artifact_id, scope_key, observed_at, force)
            receipts = await self._existing_receipts(
                conn, artifact_id, scope_key, schedule["schedule_hash"])
            inventory = inventory_for(policy)
            tombstoned = (await conn.execute(text("""
                SELECT 1 FROM evidence_lifecycle_tombstones
                WHERE artifact_id=:artifact AND scope_key=:scope AND copy_id=:copy LIMIT 1
            """), {"artifact": artifact_id, "scope": scope_key,
                "copy": policy.sink})).first() is not None
            if changed:
                body_copy = policy.sink
                receipt = await self._append_copy(conn, receipts, artifact_id,
                    scope_key, schedule["schedule_hash"], body_copy,
                    inventory[body_copy], "verified_logical", observed_at,
                    "timescale_body_cleared")
                await self._save_tombstone(conn, artifact_id, scope_key, policy, receipt, observed_at)
                receipts.append(receipt)
                root = "timescale.lifecycle_receipt"
                if root in inventory and not any(item.copy_id == root for item in receipts):
                    receipts.append(await self._append_copy(conn, receipts, artifact_id,
                        scope_key, schedule["schedule_hash"], root,
                        inventory[root], "not_applicable", observed_at,
                        "minimal_safety_root_retained"))
            elif tombstoned and not any(item.copy_id == policy.sink for item in receipts):
                receipts.append(await self._append_copy(conn, receipts, artifact_id,
                    scope_key, schedule["schedule_hash"], policy.sink, inventory[policy.sink],
                    "not_applicable", observed_at, "body_absent_prior_tombstone"))
            if not held:
                await self.issue_copy_commands(conn, artifact_id=artifact_id,
                    schedule=schedule, inventory=inventory, receipts=receipts,
                    observed_at=observed_at)
            deletion = aggregate_deletion(artifact_id, policy.policy_hash,
                schedule["schedule_hash"], receipts, observed_at, scope_key)
            result = {**deletion.model_dump(mode="json"),
                "deleted": bool(changed or tombstoned),
                "idempotency_key": idempotency_key}
            return await self._record_delete_operation(conn, result, artifact_id,
                scope_key, idempotency_key, request_hash, deletion.receipt_id,
                deletion.receipt_hash)

    async def _record_delete_operation(self, conn, result: dict, artifact_id: str,
            scope_key: str | None, idempotency_key: str | None, request_hash: str,
            receipt_id: str | None = None, receipt_hash: str | None = None) -> dict:
        if not scope_key or not idempotency_key:
            return result
        receipt_hash = receipt_hash or digest(result)
        receipt_id = receipt_id or f"eop_{receipt_hash[:48]}"
        await conn.execute(text("""
            INSERT INTO evidence_lifecycle_operation_receipts
              (receipt_id,artifact_id,scope_key,operation,idempotency_key,
               request_hash,receipt_hash,payload)
            VALUES (:id,:artifact,:scope,'delete',:key,:request,:hash,
              CAST(:payload AS jsonb))
            ON CONFLICT (scope_key,operation,idempotency_key) DO NOTHING
        """), {"id": receipt_id, "artifact": artifact_id, "scope": scope_key,
            "key": idempotency_key, "request": request_hash, "hash": receipt_hash,
            "payload": json.dumps(result, sort_keys=True, default=str)})
        return result

    async def _schedule(self, conn, artifact_id: str, scope_key: str,
            schedule_hash: str | None):
        rows = await conn.execute(text("""
            SELECT schedule_hash,scope_key,policy_hash,body_expires_at
            FROM evidence_retention_schedules
            WHERE artifact_id=:artifact AND scope_key=:scope
              AND (CAST(:hash AS text) IS NULL OR schedule_hash=CAST(:hash AS text))
            ORDER BY created_at DESC
        """), {"artifact": artifact_id, "scope": scope_key, "hash": schedule_hash})
        candidates = [dict(row._mapping) for row in rows]
        if schedule_hash or not candidates:
            return candidates[0] if candidates else None
        priority = {"timescale.analysis_body": 0, "timescale.evidence_body": 1,
            "timescale.agent_trace": 2}
        candidates.sort(key=lambda row: priority.get(
            getattr(policy_by_hash(row["policy_hash"]), "sink", ""), 9))
        return candidates[0]

    async def _clear_body(self, conn, sink: str, policy_hash: str, due_at,
            artifact_id: str, scope_key: str, now, force: bool) -> int:
        if not force and now < due_at:
            return 0
        values = {"artifact": artifact_id, "scope": scope_key,
            "account": scope_key.removeprefix("account:"), "now": now,
            "force": force, "policy": policy_hash}
        if sink == "timescale.evidence_body":
            result = await conn.execute(text("""
                UPDATE evidence SET sanitized_content=NULL,lifecycle_state='deleted',deleted_at=:now
                WHERE evidence_id=:artifact AND :scope='public' AND sanitized_content IS NOT NULL
            """), values)
            return result.rowcount
        if sink == "timescale.agent_trace":
            result = await conn.execute(text("""
                UPDATE agent_trace_events SET input_summary='{{}}'::jsonb,
                  output_summary='{{}}'::jsonb,decision_summary=NULL,error=NULL,
                  lifecycle_admitted_body=NULL,lifecycle_deleted_at=:now
                WHERE analysis_id=:artifact
                  AND scope_key=:scope AND account_id=:account
                  AND lifecycle_deleted_at IS NULL
            """), values)
            return result.rowcount
        if sink == "timescale.evaluation_case":
            result = await conn.execute(text("""
                UPDATE evaluation_cases SET market_snapshot='{}'::jsonb,
                  evidence_snapshot='[]'::jsonb,lifecycle_deleted_at=:now
                WHERE case_id=:artifact AND scope_key=:scope
                  AND lifecycle_deleted_at IS NULL AND EXISTS (
                  SELECT 1 FROM evidence_lifecycle_decisions d
                  WHERE d.decision_hash=evaluation_cases.lifecycle_decision_hash
                    AND d.scope_key=:scope)
            """), values)
            return result.rowcount
        if sink != "timescale.analysis_body":
            return 0
        statements = [
            "UPDATE analysis_runs SET synthesis='{}'::jsonb,lifecycle_deleted_at=:now "
            "WHERE analysis_id=:artifact AND scope_key=:scope "
            "AND ((:scope='public' AND account_id IS NULL) "
            "OR (:scope<>'public' AND account_id=:account)) AND lifecycle_deleted_at IS NULL",
            "UPDATE signal_reports SET report='{}'::jsonb,lifecycle_deleted_at=:now "
            "WHERE analysis_id=:artifact AND ((:scope='public' AND account_id IS NULL) "
            "OR (:scope<>'public' AND account_id=:account)) AND lifecycle_deleted_at IS NULL",
            "UPDATE provider_calls SET metadata='{}'::jsonb,error=NULL,lifecycle_deleted_at=:now "
            "WHERE analysis_id=:artifact AND ((:scope='public' AND account_id IS NULL) "
            "OR (:scope<>'public' AND account_id=:account)) AND lifecycle_deleted_at IS NULL",
            "UPDATE evaluation_runs SET prompt_bundle='{}'::jsonb,output='{}'::jsonb,"
            "validation='{}'::jsonb,strategy_results='[]'::jsonb,error=NULL,"
            "lifecycle_deleted_at=:now WHERE run_id=:artifact AND lifecycle_deleted_at IS NULL "
            "AND EXISTS (SELECT 1 FROM evidence_lifecycle_decisions d WHERE "
            "d.decision_hash=evaluation_runs.lifecycle_decision_hash AND d.scope_key=:scope)",
        ]
        changed = 0
        for statement in statements:
            changed += (await conn.execute(text(statement), values)).rowcount
        return changed

    async def _existing_receipts(self, conn, artifact_id: str, scope_key: str,
            schedule_hash: str) -> list[CopyDispositionReceipt]:
        rows = await conn.execute(text("""
            SELECT payload FROM evidence_copy_receipts
            WHERE artifact_id=:artifact AND scope_key=:scope AND schedule_hash=:schedule
            ORDER BY copy_id,revision
        """), {"artifact": artifact_id, "scope": scope_key, "schedule": schedule_hash})
        return [CopyDispositionReceipt.model_validate(row.payload) for row in rows]

    async def _append_copy(self, conn, receipts, artifact_id, scope_key, schedule_hash, copy_id, owner_id,
            status, observed_at, reference) -> CopyDispositionReceipt:
        previous = next((item for item in reversed(receipts) if item.copy_id == copy_id), None)
        body = {"artifact_id": artifact_id, "scope_key": scope_key, "schedule_hash": schedule_hash,
            "copy_id": copy_id, "owner_id": owner_id,
            "revision": previous.revision + 1 if previous else 1,
            "predecessor_hash": previous.receipt_hash if previous else None,
            "status": status, "evidence_reference": reference,
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
        return receipt

    async def _save_tombstone(self, conn, artifact_id, scope_key, policy, receipt, observed_at) -> None:
        body = {"artifact_id": artifact_id, "scope_key": scope_key, "copy_id": receipt.copy_id,
            "cutoff_at": observed_at.isoformat(), "policy_hash": policy.policy_hash,
            "inventory_hash": policy.inventory_hash, "copy_receipt_hash": receipt.receipt_hash,
            "body_present": False}
        tombstone_hash = digest(body)
        tombstone = LifecycleTombstone.model_validate({**body,
            "tombstone_id": f"elt_{tombstone_hash[:48]}", "tombstone_hash": tombstone_hash})
        await conn.execute(text("""
            INSERT INTO evidence_lifecycle_tombstones
              (tombstone_id,artifact_id,scope_key,copy_id,tombstone_hash,cutoff_at,policy_hash,
               inventory_hash,copy_receipt_hash,body_present,payload)
            VALUES (:id,:artifact,:scope,:copy,:hash,:cutoff,:policy,:inventory,:receipt,false,
              CAST(:payload AS jsonb))
            ON CONFLICT (scope_key,artifact_id,copy_id) DO NOTHING
        """), {"id": tombstone.tombstone_id, "artifact": artifact_id, "scope": scope_key,
            "copy": tombstone.copy_id, "hash": tombstone.tombstone_hash,
            "cutoff": tombstone.cutoff_at, "policy": tombstone.policy_hash,
            "inventory": tombstone.inventory_hash, "receipt": tombstone.copy_receipt_hash,
            "payload": tombstone.model_dump_json()})

    async def get_tombstone(self, artifact_id: str, copy_id: str,
            scope_key: str = "public") -> LifecycleTombstone | None:
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT tombstone_id,artifact_id,scope_key,copy_id,tombstone_hash,cutoff_at,
                       policy_hash,inventory_hash,copy_receipt_hash,body_present,payload
                FROM evidence_lifecycle_tombstones
                WHERE artifact_id=:artifact AND scope_key=:scope AND copy_id=:copy
            """), {"artifact": artifact_id, "scope": scope_key, "copy": copy_id})).first()
        if not row:
            return None
        payload = row.payload if isinstance(row.payload, dict) else json.loads(row.payload)
        columns = {"tombstone_id": row.tombstone_id, "artifact_id": row.artifact_id,
            "scope_key": row.scope_key,
            "copy_id": row.copy_id, "tombstone_hash": row.tombstone_hash,
            "cutoff_at": row.cutoff_at, "policy_hash": row.policy_hash,
            "inventory_hash": row.inventory_hash, "copy_receipt_hash": row.copy_receipt_hash,
            "body_present": row.body_present}
        normalized = LifecycleTombstone.model_validate(payload)
        if normalized.artifact_id != artifact_id or normalized.scope_key != scope_key \
                or normalized.copy_id != copy_id \
                or normalized.model_dump(mode="json") != LifecycleTombstone.model_validate(
                    columns).model_dump(mode="json"):
            raise RuntimeError("Lifecycle tombstone integrity mismatch")
        return normalized

    async def artifact_account(self, artifact_id: str, scope_key: str) -> str | None:
        async with self.engine.connect() as conn:
            return (await conn.execute(text("""
                SELECT account_id FROM analysis_runs WHERE analysis_id=:artifact
                  AND scope_key=:scope AND account_id=:account
                ORDER BY created_at DESC LIMIT 1
            """), {"artifact": artifact_id,
                "scope": scope_key,
                "account": scope_key.removeprefix("account:")})).scalar_one_or_none()
