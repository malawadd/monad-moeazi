from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy import text

from .dependency_safety_contracts import canonical_payload_digest
from .evidence_lifecycle_contracts import (
    CopyDispositionReceipt, PersistenceDecision, RetentionSchedule,
)
from .evidence_lifecycle_deletion import digest
from .evidence_lifecycle_locking import lock_lifecycle_artifacts


def _as_payload(value) -> dict:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Trace durable body is malformed") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("Trace durable body is malformed")
    return parsed


def _as_utc_datetime(value) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Trace durable body identity is invalid") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise RuntimeError("Trace durable body identity is invalid")
    return parsed


async def _assert_schedule_clear(conn, artifact_id: str, scope_key: str,
        schedule_hash: str, observed_at: datetime) -> None:
    blocked = (await conn.execute(text("""
        SELECT EXISTS (SELECT 1 FROM evidence_lifecycle_tombstones
                WHERE artifact_id=:artifact AND scope_key=:scope)
          OR EXISTS (SELECT 1 FROM evidence_lifecycle_holds
                WHERE artifact_id=:artifact AND scope_key=:scope
                  AND starts_at<=:observed AND expires_at>:observed)
          AS blocked
    """), {"artifact": artifact_id, "scope": scope_key,
        "observed": observed_at})).scalar_one()
    if blocked:
        raise RuntimeError("Trace lifecycle state blocks access")
    rows = await conn.execute(text("""
        SELECT DISTINCT ON (copy_id) receipt_id,artifact_id,scope_key,schedule_hash,
               copy_id,owner_id,revision,predecessor_hash,receipt_hash,status,
               observed_at,payload
        FROM evidence_copy_receipts WHERE artifact_id=:artifact
          AND scope_key=:scope AND schedule_hash=:schedule
        ORDER BY copy_id,revision DESC
    """), {"artifact": artifact_id, "scope": scope_key,
        "schedule": schedule_hash})
    for row in rows:
        try:
            receipt = CopyDispositionReceipt.model_validate(row.payload)
        except Exception as exc:
            raise RuntimeError("Trace copy state is unverifiable") from exc
        columns = {key: getattr(row, key) for key in (
            "receipt_id", "artifact_id", "scope_key", "schedule_hash", "copy_id",
            "owner_id", "revision", "predecessor_hash", "receipt_hash", "status",
            "observed_at")}
        normalized_columns = CopyDispositionReceipt.model_validate(columns)
        payload_values = receipt.model_dump(mode="json", exclude={"evidence_reference"})
        column_values = normalized_columns.model_dump(
            mode="json", exclude={"evidence_reference"})
        if payload_values != column_values:
            differing = sorted(key for key in payload_values
                if payload_values[key] != column_values[key])
            raise RuntimeError(
                f"Trace copy state columns are unverifiable: {','.join(differing)}")
        body = receipt.model_dump(mode="json", exclude={"receipt_id", "receipt_hash"})
        if digest(body) != receipt.receipt_hash \
                or receipt.receipt_id != f"ecd_{receipt.receipt_hash[:48]}":
            raise RuntimeError("Trace copy state hash is unverifiable")
        if receipt.status in {"partial", "unverifiable", "verified_logical",
                "verified_physical", "crypto_erased"}:
            raise RuntimeError("Trace lifecycle state blocks access")


def _validate_trace_row(row, artifact_id: str, scope_key: str,
        observed_at: datetime) -> tuple[dict, dict]:
    try:
        decision = PersistenceDecision.model_validate(row.decision_payload)
        schedule = RetentionSchedule.model_validate(row.schedule_payload)
    except Exception as exc:
        raise RuntimeError("Trace lifecycle authority is malformed") from exc
    if row.lifecycle_deleted_at is not None or not row.lifecycle_admitted_body \
            or decision.outcome not in {"allow", "transformed"} \
            or decision.decision_hash != row.lifecycle_decision_hash \
            or row.decision_hash != decision.decision_hash \
            or row.decision_scope != scope_key or decision.scope.key != scope_key \
            or row.decision_policy != decision.policy_hash \
            or row.decision_outcome != decision.outcome \
            or row.admitted_payload_hash != decision.sanitized_payload_hash \
            or decision.retention_schedule_hash != schedule.schedule_hash \
            or row.schedule_hash != schedule.schedule_hash \
            or row.schedule_scope != scope_key or schedule.scope_key != scope_key \
            or row.schedule_artifact != artifact_id or schedule.artifact_id != artifact_id \
            or row.schedule_policy != schedule.policy_hash \
            or schedule.policy_hash != decision.policy_hash \
            or row.body_expires_at != schedule.body_expires_at \
            or schedule.body_expires_at <= observed_at:
        raise RuntimeError("Trace lifecycle authority is unavailable")
    body = str(row.lifecycle_admitted_body)
    payload = _as_payload(body)
    if payload.get("analysis_id") != artifact_id \
            or payload.get("event_id") != row.event_id \
            or payload.get("account_id") != scope_key.removeprefix("account:") \
            or _as_utc_datetime(payload.get("created_at")) != row.created_at:
        raise RuntimeError("Trace durable body identity is invalid")
    body_hash = canonical_payload_digest({"event_id": row.event_id, "content": body})
    if decision.sanitized_payload_hash != body_hash:
        raise RuntimeError("Trace durable body decision binding is invalid")
    binding = {"event_id": row.event_id, "created_at": row.created_at.isoformat(),
        "decision_hash": decision.decision_hash,
        "schedule_hash": schedule.schedule_hash, "admitted_body_hash": body_hash}
    return payload, binding


async def load_disclosable_trace_events(conn, artifact_id: str, scope_key: str,
        observed_at: datetime, *, expected_bindings: list[dict] | None = None,
        event_id: str | None = None, event_created_at: datetime | None = None,
        decision_hash: str | None = None,
        acquire_lock: bool = True) -> tuple[list[dict], list[dict]]:
    if acquire_lock:
        await lock_lifecycle_artifacts(conn, scope_key, [artifact_id])
    result = await conn.execute(text("""
        SELECT t.event_id,t.created_at,t.lifecycle_deleted_at,t.lifecycle_admitted_body,
               t.lifecycle_decision_hash,d.payload AS decision_payload,
               d.decision_hash,d.scope_key AS decision_scope,d.outcome AS decision_outcome,
               d.policy_hash AS decision_policy,d.admitted_payload_hash,
               s.payload AS schedule_payload,s.schedule_hash,
               s.scope_key AS schedule_scope,s.artifact_id AS schedule_artifact,
               s.policy_hash AS schedule_policy,s.body_expires_at
        FROM agent_trace_events t
        LEFT JOIN evidence_lifecycle_decisions d
          ON d.decision_hash=t.lifecycle_decision_hash AND d.scope_key=:scope
        LEFT JOIN evidence_retention_schedules s ON s.schedule_hash=
          d.payload->>'retention_schedule_hash' AND s.scope_key=:scope
        WHERE t.scope_key=:scope AND t.analysis_id=:artifact
          AND (CAST(:event AS text) IS NULL OR t.event_id=CAST(:event AS text))
          AND (CAST(:created AS timestamptz) IS NULL OR t.created_at=:created)
          AND (CAST(:decision AS text) IS NULL
            OR t.lifecycle_decision_hash=CAST(:decision AS text))
          AND t.created_at > CAST(:observed AS timestamptz) - interval '7 days'
        ORDER BY t.created_at,t.event_id FOR UPDATE OF t
    """), {"artifact": artifact_id, "scope": scope_key, "event": event_id,
        "created": event_created_at, "decision": decision_hash,
        "observed": observed_at})
    rows = list(result.all())
    if event_id is not None and len(rows) != 1:
        raise RuntimeError("Trace lifecycle identity is ambiguous or unavailable")
    events: list[dict] = []
    bindings: list[dict] = []
    checked_schedules: set[str] = set()
    for row in rows:
        event, binding = _validate_trace_row(row, artifact_id, scope_key, observed_at)
        if binding["schedule_hash"] not in checked_schedules:
            await _assert_schedule_clear(conn, artifact_id, scope_key,
                binding["schedule_hash"], observed_at)
            checked_schedules.add(binding["schedule_hash"])
        events.append(event)
        bindings.append(binding)
    if expected_bindings is not None:
        normalize = lambda values: sorted(values,
            key=lambda item: (item["created_at"], item["event_id"]))
        if normalize(bindings) != normalize(expected_bindings):
            raise RuntimeError("Trace disclosure collection binding is invalid")
    return events, bindings
