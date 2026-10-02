from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .dependency_safety_contracts import DependencyHealthReceipt, SafetyEnvelopeDecision
from .dependency_safety_contracts import DependencyStatus, digest
from .dependency_safety_matrix import dependency_spec, incident_key


class IdempotencyConflictError(RuntimeError):
    pass


class DependencySafetyRepository:
    def __init__(self, engine: AsyncEngine):
        self.engine = engine

    async def save_bundle(
        self,
        receipts: list[DependencyHealthReceipt],
        decision: SafetyEnvelopeDecision,
        recovery_enabled: bool = True,
    ) -> None:
        async with self.engine.begin() as conn:
            prior = (await conn.execute(text("""
                SELECT decision_hash FROM safety_envelope_decisions
                WHERE matrix_version = :matrix_version AND idempotency_key = :idempotency_key
                ORDER BY evaluated_at DESC, decision_hash DESC LIMIT 1
            """), {
                "matrix_version": decision.matrix_version,
                "idempotency_key": decision.idempotency_key,
            })).first()
            if prior and prior.decision_hash != decision.decision_hash:
                raise IdempotencyConflictError(
                    "Dependency safety idempotency key is already bound to another decision"
                )
            for receipt in receipts:
                await conn.execute(text("""
                    INSERT INTO dependency_health_receipts
                      (receipt_id, dependency_id, failure_domain, scope, status,
                       observed_at, expires_at, reason_code, evidence_reference,
                       source_revision, adapter_version, observation_key,
                       supersedes_receipt_id, canonical_hash, payload)
                    VALUES (:receipt_id, :dependency_id, :failure_domain,
                            CAST(:scope AS jsonb), :status, :observed_at, :expires_at,
                            :reason_code, :evidence_reference, :source_revision,
                            :adapter_version, :observation_key, :supersedes_receipt_id,
                            :canonical_hash, CAST(:payload AS jsonb))
                    ON CONFLICT (receipt_id) DO NOTHING
                """), {
                    **receipt.model_dump(mode="python"),
                    "failure_domain": receipt.failure_domain.value,
                    "status": receipt.status.value,
                    "scope": receipt.scope.model_dump_json(),
                    "payload": receipt.model_dump_json(),
                })
                await self._save_incident_observation(conn, receipt, recovery_enabled)
            await conn.execute(text("""
                INSERT INTO safety_envelope_decisions
                  (decision_id, matrix_version, mode, operation, subject_key, scope,
                   breaker_state, outcome, reasons, receipt_hashes, incident_keys,
                   bindings, evaluated_at, expires_at, idempotency_key, decision_hash,
                   payload)
                VALUES (:decision_id, :matrix_version, :mode, :operation, :subject_key,
                        CAST(:scope AS jsonb), :breaker_state, :outcome,
                        CAST(:reasons AS jsonb), CAST(:receipt_hashes AS jsonb),
                        CAST(:incident_keys AS jsonb), CAST(:bindings AS jsonb),
                        :evaluated_at, :expires_at, :idempotency_key, :decision_hash,
                        CAST(:payload AS jsonb))
                ON CONFLICT (decision_id) DO NOTHING
            """), {
                **decision.model_dump(mode="python"),
                "operation": decision.operation.value,
                "scope": decision.scope.model_dump_json(),
                "reasons": json.dumps(decision.reasons),
                "receipt_hashes": json.dumps(decision.receipt_hashes),
                "incident_keys": json.dumps(decision.incident_keys),
                "bindings": json.dumps(decision.bindings),
                "payload": decision.model_dump_json(),
            })

    async def load_current_receipts(
        self, dependency_ids: tuple[str, ...], scope,
    ) -> list[DependencyHealthReceipt]:
        if not dependency_ids:
            return []
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("""
                SELECT DISTINCT ON (dependency_id, scope->>'key') payload
                FROM dependency_health_receipts
                WHERE dependency_id = ANY(:dependency_ids)
                ORDER BY dependency_id, scope->>'key', observed_at DESC, canonical_hash DESC
            """), {"dependency_ids": list(dependency_ids)})
            candidates = [DependencyHealthReceipt.model_validate(dict(row.payload)) for row in rows]
        from .dependency_safety_matrix import scope_applies
        return [item for item in candidates if scope_applies(item.scope, scope)]

    @staticmethod
    async def _save_incident_observation(
        conn, receipt: DependencyHealthReceipt, recovery_enabled: bool,
    ) -> None:
        current_receipt = (await conn.execute(text("""
            SELECT receipt_id FROM dependency_health_receipts
            WHERE dependency_id = :dependency_id AND scope->>'key' = :scope_key
            ORDER BY observed_at DESC, canonical_hash DESC LIMIT 1
        """), {
            "dependency_id": receipt.dependency_id, "scope_key": receipt.scope.key,
        })).first()
        if not current_receipt or current_receipt.receipt_id != receipt.receipt_id:
            return
        key = incident_key(receipt.dependency_id, receipt.scope)
        row = (await conn.execute(text("""
            SELECT to_state, observed_at, receipt_hash FROM dependency_incident_transitions
            WHERE incident_key = :incident_key ORDER BY observed_at DESC LIMIT 1
        """), {"incident_key": key})).first()
        if row and row.receipt_hash == receipt.canonical_hash:
            return
        if row and row.observed_at > receipt.observed_at:
            return
        unhealthy = receipt.status is not DependencyStatus.HEALTHY
        if not unhealthy and not recovery_enabled:
            return
        from_state = row.to_state if row else None
        if unhealthy:
            to_state = "open"
        elif not row or from_state == "resolved":
            return
        elif from_state == "open":
            to_state = "half_open"
        else:
            interval = dependency_spec(receipt.dependency_id).recovery_interval_seconds
            if (receipt.observed_at - row.observed_at).total_seconds() < interval:
                return
            to_state = "resolved"
        payload = {
            "incident_key": key, "dependency_id": receipt.dependency_id,
            "scope": receipt.scope.model_dump(mode="json"), "from_state": from_state,
            "to_state": to_state, "receipt_hash": receipt.canonical_hash,
            "observed_at": receipt.observed_at.isoformat(),
        }
        transition_id = f"dit_{digest(payload)[:48]}"
        await conn.execute(text("""
            INSERT INTO dependency_incident_transitions
              (transition_id, incident_key, dependency_id, scope, from_state, to_state,
               receipt_hash, observed_at, payload)
            VALUES (:transition_id, :incident_key, :dependency_id, CAST(:scope AS jsonb),
                    :from_state, :to_state, :receipt_hash, :observed_at,
                    CAST(:payload AS jsonb))
            ON CONFLICT (transition_id) DO NOTHING
        """), {
            **payload, "transition_id": transition_id,
            "observed_at": receipt.observed_at,
            "scope": json.dumps(payload["scope"]), "payload": json.dumps(payload),
        })

    async def latest_decisions(self, account_id: str, limit: int = 50) -> list[dict]:
        async with self.engine.connect() as conn:
            rows = await conn.execute(text("""
                SELECT payload FROM safety_envelope_decisions
                WHERE scope->>'strategy_account_id' = :account
                ORDER BY evaluated_at DESC LIMIT :limit
            """), {"account": account_id, "limit": max(1, min(limit, 200))})
            return [dict(row.payload) for row in rows]
