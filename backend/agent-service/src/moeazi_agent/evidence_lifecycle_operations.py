from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from .dependency_safety_contracts import canonical_json, canonical_payload_digest
from .evidence_lifecycle_contracts import (
    AccessReceipt, ExportReceipt, LifecycleHold, LifecycleScope,
)
from .evidence_lifecycle_registry import policy_for
from .evidence_lifecycle_evaluator import evaluate_persistence
from .evidence_lifecycle_deletion import validate_restore
from .evidence_lifecycle_storage import EvidenceLifecycleRepository


def _digest(value) -> str:
    return sha256(canonical_json(value)).hexdigest()


def operation_idempotency_key(operation: str, artifact: str, output) -> str:
    output_hash = canonical_payload_digest(output)
    artifact_hash = sha256(artifact.encode()).hexdigest()
    return f"{operation}:{artifact_hash[:16]}:{output_hash[:24]}"


async def record_access(repository: EvidenceLifecycleRepository, *, artifact_id: str,
        account_id: str, viewer_subject: str, output, idempotency_key: str,
        observed_at: datetime, purpose: str = "monitoring",
        source_artifact_ids: list[str] | None = None,
        source_trace_bindings: list[dict] | None = None) -> tuple[AccessReceipt, object | None]:
    scope = LifecycleScope(kind="account", key=f"account:{account_id}",
        strategy_account_id=account_id)
    viewer_hash = _digest({"viewer": viewer_subject})
    envelope = {"artifact_id": artifact_id, "operation": "access",
        "viewer_hash": viewer_hash, "content": output}
    request_hash = canonical_payload_digest(envelope)
    decision_key = _decision_key("access", scope.key, idempotency_key)
    decision, admitted, transforms, schedule = evaluate_persistence(
        producer="monitoring_export", purpose="monitoring",
        sink="monitoring.evidence_output", scope=scope, payload=envelope,
        artifact_id=artifact_id, idempotency_key=decision_key,
        observed_at=observed_at)
    permitted = decision.outcome in {"allow", "transformed"}
    admitted_output = admitted.get("content") if permitted else None
    body = {"artifact_id": artifact_id, "scope": scope.model_dump(mode="json"),
        "viewer_hash": viewer_hash, "purpose": purpose,
        "decision_hash": decision.decision_hash, "request_hash": request_hash,
        "idempotency_key": idempotency_key,
        "output_hash": canonical_payload_digest(admitted_output) if permitted else None,
        "outcome": "allow" if permitted else "block",
        "reason_codes": ["allowed"] if permitted else decision.reasons,
        "accessed_at": observed_at.isoformat()}
    receipt_hash = _digest(body)
    receipt = AccessReceipt.model_validate({**body,
        "receipt_id": f"ear_{receipt_hash[:48]}", "receipt_hash": receipt_hash})
    stored = await repository.save_disclosure_operation("access", receipt.receipt_id, artifact_id,
        scope.key, receipt_hash, {"receipt": receipt.model_dump(mode="json")},
        idempotency_key=idempotency_key, request_hash=request_hash,
        observed_at=observed_at, decision=decision, transforms=transforms, schedule=schedule,
        source_artifact_ids=source_artifact_ids,
        source_trace_bindings=source_trace_bindings)
    stored_receipt = AccessReceipt.model_validate(stored["receipt"])
    return stored_receipt, _replay_output(envelope, stored_receipt,
        artifact_id, decision_key, "access")


async def record_local_export(repository: EvidenceLifecycleRepository, *, artifact_id: str,
        account_id: str, viewer_subject: str, output, idempotency_key: str,
        observed_at: datetime,
        source_trace_bindings: list[dict] | None = None) -> tuple[ExportReceipt, object | None]:
    scope = LifecycleScope(kind="account", key=f"account:{account_id}",
        strategy_account_id=account_id)
    viewer_hash = _digest({"viewer": viewer_subject})
    envelope = {"artifact_id": artifact_id, "operation": "export",
        "viewer_hash": viewer_hash, "content": output}
    request_hash = canonical_payload_digest(envelope)
    decision_key = _decision_key("export", scope.key, idempotency_key)
    decision, admitted, transforms, schedule = evaluate_persistence(
        producer="monitoring_export", purpose="monitoring",
        sink="monitoring.evidence_output", scope=scope, payload=envelope,
        artifact_id=artifact_id, idempotency_key=decision_key,
        observed_at=observed_at)
    policy = policy_for("monitoring_export", "monitoring", "monitoring.evidence_output")
    permitted = decision.outcome in {"allow", "transformed"}
    admitted_output = admitted.get("content") if permitted else None
    body = {"artifact_id": artifact_id, "scope": scope.model_dump(mode="json"),
        "sink": "monitoring.evidence_output", "decision_hash": decision.decision_hash,
        "request_hash": request_hash, "idempotency_key": idempotency_key,
        "expected_copies": policy.expected_copies,
        "output_hash": canonical_payload_digest(admitted_output) if permitted else None,
        "outcome": "transformed" if permitted else "block",
        "reason_codes": ["transformed"] if permitted else decision.reasons,
        "exported_at": observed_at.isoformat()}
    receipt_hash = _digest(body)
    receipt = ExportReceipt.model_validate({**body,
        "receipt_id": f"eer_{receipt_hash[:48]}", "receipt_hash": receipt_hash})
    stored = await repository.save_disclosure_operation("export", receipt.receipt_id, artifact_id,
        scope.key, receipt_hash, {"receipt": receipt.model_dump(mode="json")},
        idempotency_key=idempotency_key, request_hash=request_hash,
        observed_at=observed_at, decision=decision, transforms=transforms,
        schedule=schedule, source_trace_bindings=source_trace_bindings)
    stored_receipt = ExportReceipt.model_validate(stored["receipt"])
    return stored_receipt, _replay_output(envelope, stored_receipt,
        artifact_id, decision_key, "export")


def _decision_key(operation: str, scope_key: str, idempotency_key: str) -> str:
    binding = canonical_payload_digest({"operation": operation, "scope": scope_key,
        "idempotency_key": idempotency_key})
    return f"{operation}:{binding[:48]}"


def _replay_output(envelope: dict, receipt, artifact_id: str,
        decision_key: str, operation: str):
    observed_at = receipt.accessed_at if operation == "access" else receipt.exported_at
    decision, admitted, _, _ = evaluate_persistence(
        producer="monitoring_export", purpose="monitoring",
        sink="monitoring.evidence_output", scope=receipt.scope, payload=envelope,
        artifact_id=artifact_id, idempotency_key=decision_key, observed_at=observed_at)
    output = admitted.get("content") \
        if decision.outcome in {"allow", "transformed"} else None
    if decision.decision_hash != receipt.decision_hash \
            or (canonical_payload_digest(output) if output is not None else None) \
            != receipt.output_hash:
        raise RuntimeError(f"Evidence {operation} replay binding is invalid")
    return output


async def create_hold(repository: EvidenceLifecycleRepository, *, artifact_id: str,
        account_id: str, reviewer_subject: str, reason_code: str,
        duration_seconds: int, idempotency_key: str) -> LifecycleHold:
    now = datetime.now(timezone.utc)
    duration = max(60, min(86_400, duration_seconds))
    return await repository.create_or_replay_hold(artifact_id=artifact_id,
        scope_key=f"account:{account_id}", reviewer_hash=_digest({"viewer": reviewer_subject}),
        reason_code=reason_code, duration_seconds=duration,
        idempotency_key=idempotency_key, observed_at=now)


async def record_local_delete(repository: EvidenceLifecycleRepository, *, artifact_id: str,
        account_id: str, idempotency_key: str) -> dict:
    now = datetime.now(timezone.utc)
    return await repository.dispose_artifact(artifact_id, now, force=True,
        scope_key=f"account:{account_id}", idempotency_key=idempotency_key)


async def validate_runtime_restore(repository: EvidenceLifecycleRepository, *,
        artifact_id: str, copy_id: str, current_policy_hash: str,
        restored_policy_hash: str, inventory_hash: str | None,
        scope_matches: bool, evaluated_at: datetime, scope_key: str = "public"):
    invalid = False
    try:
        tombstone = await repository.get_tombstone(artifact_id, copy_id, scope_key)
    except (RuntimeError, ValueError):
        tombstone, invalid = None, True
    return validate_restore(artifact_id=artifact_id,
        current_policy_hash=current_policy_hash,
        restored_policy_hash=restored_policy_hash, inventory_hash=inventory_hash,
        tombstone=tombstone, scope_matches=scope_matches, evaluated_at=evaluated_at,
        tombstone_invalid=invalid)
