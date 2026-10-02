"""Fail-closed disclosure checks for persisted Evaluation Lab archives.

Evaluation runs are admitted as one lifecycle-governed archive before they are
stored.  Read paths must reconstruct that exact admitted body instead of trusting
the mutable presentation columns independently.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from .dependency_safety_contracts import canonical_payload_digest
from .evidence_lifecycle_contracts import PersistenceDecision, RetentionSchedule
from .evidence_lifecycle_identity import evaluation_owner_scope_key

_ARCHIVE_FIELDS = (
    "run_id", "experiment_id", "case_id", "subject_id", "analysis_id", "status",
    "prompt_bundle", "output", "validation", "strategy_results", "input_tokens",
    "output_tokens", "provider_cost_microusd", "latency_ms", "error",
)


def admitted_archive_body(run: dict[str, Any]) -> dict[str, Any]:
    """Return the sole body whose hash is bound by an archive decision."""
    if set(_ARCHIVE_FIELDS) - set(run):
        raise ValueError("Evaluation archive body is incomplete")
    return {field: run[field] for field in _ARCHIVE_FIELDS}


def archive_content(body: dict[str, Any]) -> str:
    return json.dumps(body, sort_keys=True, separators=(",", ":"), default=str)


def validate_archive_row(row: dict[str, Any], owner: str,
        observed_at: datetime, expected_scope_key: str | None = None) -> dict[str, Any] | None:
    """Return a verified public row or ``None`` without leaking a bad body."""
    try:
        decision = PersistenceDecision.model_validate(row.pop("_lifecycle_decision", None))
        schedule = RetentionSchedule.model_validate(row.pop("_lifecycle_schedule", None))
        admitted = row.pop("lifecycle_admitted_body", None)
        stored_hash = row.get("lifecycle_decision_hash")
        if not isinstance(admitted, dict) or stored_hash != decision.decision_hash:
            return None
        scope_key = expected_scope_key or evaluation_owner_scope_key(owner)
        if (decision.producer, decision.purpose, decision.sink) != (
                "evaluation_archive", "evaluation", "timescale.analysis_body"):
            return None
        if (decision.scope.kind != ("account" if scope_key.startswith("account:") else "tenant")
                or decision.scope.key != scope_key
                or schedule.scope_key != scope_key or schedule.artifact_id != row["run_id"]
                or decision.retention_schedule_hash != schedule.schedule_hash
                or decision.policy_hash != schedule.policy_hash
                or decision.outcome not in {"allow", "transformed"}
                or decision.expires_at <= decision.evaluated_at
                or schedule.body_expires_at <= observed_at
                or row.get("lifecycle_deleted_at") is not None):
            return None
        body = admitted_archive_body(admitted)
        if body != admitted_archive_body(row):
            return None
        payload = {"case_id": row["case_id"], "run_id": row["run_id"],
            "content": archive_content(body), "status": row["status"]}
        if decision.sanitized_payload_hash != canonical_payload_digest(payload):
            return None
    except (KeyError, TypeError, ValueError):
        return None
    for field in ("_lifecycle_decision", "_lifecycle_schedule", "lifecycle_admitted_body"):
        row.pop(field, None)
    return row
