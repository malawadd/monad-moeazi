from __future__ import annotations

import json
from datetime import datetime, timezone
from hashlib import sha256

from sqlalchemy import text

from .dependency_safety_contracts import canonical_json, canonical_request_value
from .evidence_lifecycle_contracts import PersistenceDecision, RetentionSchedule


def _json_value(value):
    return json.loads(value) if isinstance(value, str) else value


def _contract_hash(contract, excluded: set[str], time_fields: tuple[str, ...]) -> str:
    body = contract.model_dump(mode="json", exclude=excluded)
    for field in time_fields:
        body[field] = getattr(contract, field).isoformat()
    return sha256(canonical_json(canonical_request_value(body))).hexdigest()


class EvidenceLifecycleDispatchRepository:
    async def verify_provider_dispatch(self, decision: PersistenceDecision,
            schedule: RetentionSchedule, observed_at: datetime) -> None:
        """Reload both immutable authority contracts at the provider boundary."""
        if observed_at.tzinfo is None or observed_at.utcoffset() != timezone.utc.utcoffset(observed_at):
            raise RuntimeError("Provider dispatch time must be UTC")
        async with self.engine.connect() as conn:
            row = (await conn.execute(text("""
                SELECT d.decision_id,d.idempotency_key,d.input_digest,d.decision_hash,
                  d.producer,d.purpose,d.sink,d.scope_kind,d.scope_key,d.policy_hash,
                  d.inventory_hash,d.outcome,d.reasons,d.evaluated_at,d.expires_at,
                  d.admitted_payload_hash,d.payload,
                  s.schedule_id,s.artifact_id AS schedule_artifact_id,
                  s.scope_key AS schedule_scope_key,s.policy_hash AS schedule_policy_hash,
                  s.schedule_hash,s.body_expires_at AS schedule_body_expires_at,
                  s.expected_copies AS schedule_expected_copies,
                  s.payload AS schedule_payload
                FROM evidence_lifecycle_decisions d
                JOIN evidence_retention_schedules s ON s.schedule_hash=
                  d.payload->>'retention_schedule_hash' AND s.scope_key=d.scope_key
                WHERE d.decision_hash=:hash AND d.scope_key=:scope
                  AND d.producer=:producer AND d.purpose=:purpose AND d.sink=:sink
                  AND s.artifact_id=:artifact
            """), {"hash": decision.decision_hash, "scope": decision.scope.key,
                "producer": decision.producer, "purpose": decision.purpose,
                "sink": decision.sink, "artifact": schedule.artifact_id})).first()
        if not row:
            raise RuntimeError("Persisted provider lifecycle authority is unavailable")
        try:
            persisted_decision = PersistenceDecision.model_validate(_json_value(row.payload))
            persisted_schedule = RetentionSchedule.model_validate(
                _json_value(row.schedule_payload))
            row_reasons = _json_value(row.reasons)
            row_expected_copies = _json_value(row.schedule_expected_copies)
        except Exception as exc:
            raise RuntimeError("Persisted provider lifecycle authority is malformed") from exc
        decision_row = {
            "decision_id": row.decision_id, "idempotency_key": row.idempotency_key,
            "input_digest": row.input_digest, "decision_hash": row.decision_hash,
            "producer": row.producer, "purpose": row.purpose, "sink": row.sink,
            "scope_kind": row.scope_kind, "scope_key": row.scope_key,
            "policy_hash": row.policy_hash, "inventory_hash": row.inventory_hash,
            "outcome": row.outcome, "reasons": row_reasons,
            "evaluated_at": row.evaluated_at, "expires_at": row.expires_at,
            "sanitized_payload_hash": row.admitted_payload_hash,
        }
        decision_binding = {
            "decision_id": persisted_decision.decision_id,
            "idempotency_key": persisted_decision.idempotency_key,
            "input_digest": persisted_decision.input_digest,
            "decision_hash": persisted_decision.decision_hash,
            "producer": persisted_decision.producer, "purpose": persisted_decision.purpose,
            "sink": persisted_decision.sink, "scope_kind": persisted_decision.scope.kind,
            "scope_key": persisted_decision.scope.key,
            "policy_hash": persisted_decision.policy_hash,
            "inventory_hash": persisted_decision.inventory_hash,
            "outcome": persisted_decision.outcome, "reasons": persisted_decision.reasons,
            "evaluated_at": persisted_decision.evaluated_at,
            "expires_at": persisted_decision.expires_at,
            "sanitized_payload_hash": persisted_decision.sanitized_payload_hash,
        }
        schedule_row = {
            "schedule_id": row.schedule_id,
            "artifact_id": row.schedule_artifact_id,
            "scope_key": row.schedule_scope_key,
            "policy_hash": row.schedule_policy_hash,
            "schedule_hash": row.schedule_hash,
            "body_expires_at": row.schedule_body_expires_at,
            "expected_copies": row_expected_copies,
        }
        schedule_binding = {
            "schedule_id": persisted_schedule.schedule_id,
            "artifact_id": persisted_schedule.artifact_id,
            "scope_key": persisted_schedule.scope_key,
            "policy_hash": persisted_schedule.policy_hash,
            "schedule_hash": persisted_schedule.schedule_hash,
            "body_expires_at": persisted_schedule.body_expires_at,
            "expected_copies": persisted_schedule.expected_copies,
        }
        decision_hash = _contract_hash(persisted_decision,
            {"decision_id", "decision_hash"}, ("evaluated_at", "expires_at"))
        schedule_hash = _contract_hash(persisted_schedule,
            {"schedule_id", "schedule_hash"}, ("body_expires_at",))
        invalid = (
            decision_hash != persisted_decision.decision_hash
            or schedule_hash != persisted_schedule.schedule_hash
            or persisted_decision.decision_id != f"eld_{decision_hash[:48]}"
            or persisted_schedule.schedule_id != f"ers_{schedule_hash[:48]}"
            or decision_row != decision_binding or schedule_row != schedule_binding
            or persisted_decision.model_dump(mode="json") != decision.model_dump(mode="json")
            or persisted_schedule.model_dump(mode="json") != schedule.model_dump(mode="json")
            or persisted_decision.retention_schedule_hash != persisted_schedule.schedule_hash
            or persisted_decision.policy_hash != persisted_schedule.policy_hash
            or persisted_decision.scope.key != persisted_schedule.scope_key
        )
        if invalid:
            raise RuntimeError("Persisted provider lifecycle authority binding is invalid")
        authority_expiry = min(persisted_decision.expires_at,
            persisted_schedule.body_expires_at)
        if persisted_decision.outcome not in {"allow", "transformed"} \
                or observed_at >= authority_expiry:
            raise RuntimeError("Persisted provider lifecycle authority is expired or blocked")
