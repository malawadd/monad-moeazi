from __future__ import annotations

import json
from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field
from sqlalchemy import text

from .contracts import StrictModel
from .dependency_safety_contracts import (
    SafetyEnvelopeDecision, SafetyOperation, canonical_payload_digest,
)
from .dependency_safety_matrix import verify_safety_decision
from .evidence_lifecycle_operations import operation_idempotency_key, record_access
from .evidence_lifecycle_storage import EvidenceLifecycleRepository


class SafetyStreamNotification(StrictModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: Literal[1]
    account_id: str = Field(min_length=1, max_length=120)
    scope_key: str = Field(min_length=1, max_length=180)
    operation: SafetyOperation
    decision_id: str = Field(min_length=16, max_length=80)
    decision_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    decision_evaluated_at: datetime
    projection_id: str = Field(min_length=1, max_length=180)
    projection_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    projection_revision: int = Field(ge=1)
    projected_at: datetime


class SafetyProjection(StrictModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    projection_id: str = Field(alias="_id", min_length=1, max_length=180)
    creation_time: float = Field(alias="_creationTime")
    schema_version: int = Field(alias="schemaVersion")
    strategy_account_id: str = Field(alias="strategyAccountId", min_length=1, max_length=120)
    operation: SafetyOperation
    subject_key: str = Field(alias="subjectKey", min_length=1, max_length=180)
    scope_key: str = Field(alias="scopeKey", min_length=1, max_length=180)
    mode: Literal["observe", "enforce"]
    breaker_state: Literal["closed", "open", "half_open", "recovering"] = \
        Field(alias="breakerState")
    outcome: Literal["allow", "block"]
    reasons: list[str] = Field(max_length=32)
    receipt_hashes: list[str] = Field(alias="receiptHashes", max_length=32)
    incident_keys: list[str] = Field(alias="incidentKeys", max_length=32)
    bindings_json: str = Field(alias="bindingsJson", max_length=8_000)
    decision_id: str = Field(alias="decisionId", min_length=16, max_length=80)
    decision_hash: str = Field(alias="decisionHash", pattern=r"^[a-f0-9]{64}$")
    matrix_version: str = Field(alias="matrixVersion", max_length=80)
    evaluated_at: int = Field(alias="evaluatedAt")
    expires_at: int = Field(alias="expiresAt")
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=180)
    binding_hash: str = Field(alias="bindingHash", pattern=r"^[a-f0-9]{64}$")
    request_hash: str = Field(alias="requestHash", pattern=r"^[a-f0-9]{64}$")
    projection_revision: int = Field(alias="projectionRevision", ge=1)
    projection_hash: str = Field(alias="projectionHash", pattern=r"^[a-f0-9]{64}$")
    updated_at: int = Field(alias="updatedAt")


def projection_hash_body(*, account_id: str, scope_key: str,
        operation: SafetyOperation | str, decision_id: str, decision_hash: str,
        projection_revision: int, projected_at: int) -> dict:
    return {"schemaVersion": 1, "strategyAccountId": account_id,
        "scopeKey": scope_key,
        "operation": operation.value if isinstance(operation, SafetyOperation) else operation,
        "decisionId": decision_id, "decisionHash": decision_hash,
        "projectionRevision": projection_revision, "projectedAt": projected_at}


def build_safety_notification(decision: SafetyEnvelopeDecision,
        projection: dict) -> SafetyStreamNotification | None:
    required = {"projectionId", "projectionHash", "projectionRevision", "projectedAt"}
    if not isinstance(projection, dict) or not required.issubset(projection) \
            or projection.get("superseded") is True \
            or not decision.scope.strategy_account_id:
        return None
    return SafetyStreamNotification.model_validate({
        "schema_version": 1,
        "account_id": decision.scope.strategy_account_id,
        "scope_key": decision.scope.key,
        "operation": decision.operation,
        "decision_id": decision.decision_id,
        "decision_hash": decision.decision_hash,
        "decision_evaluated_at": decision.evaluated_at,
        "projection_id": projection["projectionId"],
        "projection_hash": projection["projectionHash"],
        "projection_revision": projection["projectionRevision"],
        "projected_at": datetime.fromtimestamp(projection["projectedAt"] / 1_000,
            tz=decision.evaluated_at.tzinfo),
    })


def parse_safety_notification(data: str, account_id: str) -> SafetyStreamNotification | None:
    try:
        value = SafetyStreamNotification.model_validate_json(data)
    except Exception:
        return None
    account_scope = f"account:{account_id}"
    if value.account_id != account_id \
            or (value.scope_key != account_scope
                and not value.scope_key.startswith(f"{account_scope}:")):
        return None
    return value


def _json(value):
    if isinstance(value, str):
        return json.loads(value)
    return value


def _epoch_ms(value: datetime) -> int:
    return int(value.timestamp() * 1_000)


class DependencySafetyStreamDisclosure:
    def __init__(self, engine, convex):
        self.engine = engine
        self.convex = convex

    async def disclose(self, notification: SafetyStreamNotification, account_id: str,
            viewer_subject: str, observed_at: datetime) -> dict:
        if notification.account_id != account_id:
            raise RuntimeError("Safety stream account binding is invalid")
        decision, display_reasons = await self._load_decision(
            notification, account_id, observed_at)
        await self._assert_projection(notification, decision, account_id, observed_at)
        output = {"schema_version": 1, "scope_key": decision.scope.key,
            "operation": decision.operation.value, "mode": decision.mode,
            "breaker_state": decision.breaker_state, "outcome": decision.outcome,
            "reason_codes": display_reasons, "decision_hash": decision.decision_hash,
            "matrix_version": decision.matrix_version,
            "evaluated_at": decision.evaluated_at.isoformat(),
            "expires_at": decision.expires_at.isoformat(),
            "projection_revision": notification.projection_revision,
            "projection_hash": notification.projection_hash}
        key = operation_idempotency_key(
            "access", f"safety-stream:{account_id}", output)
        _, admitted = await record_access(EvidenceLifecycleRepository(self.engine),
            artifact_id=f"monitoring:safety:{account_id}", account_id=account_id,
            viewer_subject=viewer_subject, output=output, idempotency_key=key,
            observed_at=observed_at)
        if admitted is None:
            raise RuntimeError("Safety stream lifecycle admission is unavailable")
        await self._assert_projection(notification, decision, account_id, observed_at)
        return admitted

    async def _load_decision(self, notification, account_id, observed_at):
        async with self.engine.connect() as conn:
            result = await conn.execute(text("""
                SELECT decision_id,matrix_version,mode,operation,subject_key,scope,
                       breaker_state,outcome,reasons,receipt_hashes,incident_keys,
                       bindings,evaluated_at,expires_at,idempotency_key,decision_hash,payload
                FROM safety_envelope_decisions
                WHERE decision_id=:id AND decision_hash=:hash
                  AND scope->>'strategy_account_id'=:account AND scope->>'key'=:scope
                ORDER BY evaluated_at DESC LIMIT 2
            """), {"id": notification.decision_id, "hash": notification.decision_hash,
                "account": account_id, "scope": notification.scope_key})
            rows = list(result.all())
        if len(rows) != 1:
            raise RuntimeError("Safety stream durable decision is unavailable")
        row = rows[0]
        try:
            decision = SafetyEnvelopeDecision.model_validate(_json(row.payload))
        except Exception as exc:
            raise RuntimeError("Safety stream durable decision is malformed") from exc
        columns = {"decision_id": row.decision_id, "matrix_version": row.matrix_version,
            "mode": row.mode, "operation": row.operation, "subject_key": row.subject_key,
            "scope": _json(row.scope), "breaker_state": row.breaker_state,
            "outcome": row.outcome, "reasons": _json(row.reasons),
            "receipt_hashes": _json(row.receipt_hashes),
            "incident_keys": _json(row.incident_keys), "bindings": _json(row.bindings),
            "evaluated_at": row.evaluated_at, "expires_at": row.expires_at,
            "idempotency_key": row.idempotency_key, "decision_hash": row.decision_hash,
            "binding_hash": decision.binding_hash, "request_hash": decision.request_hash,
            "schema_version": decision.schema_version}
        normalized = SafetyEnvelopeDecision.model_validate(columns)
        try:
            display_reasons = verify_safety_decision(
                decision, decision.operation, decision.subject_key,
                decision.idempotency_key, observed_at, decision.bindings,
                decision.request_hash, require_permit=False)
        except ValueError as exc:
            raise RuntimeError("Safety stream durable decision integrity is invalid") from exc
        if normalized.model_dump(mode="json") != decision.model_dump(mode="json") \
                or decision.scope.strategy_account_id != account_id \
                or decision.scope.key != notification.scope_key \
                or decision.operation != notification.operation \
                or decision.evaluated_at != notification.decision_evaluated_at \
                or decision.expires_at <= observed_at:
            raise RuntimeError("Safety stream durable decision integrity is invalid")
        return decision, display_reasons

    async def _assert_projection(self, notification, decision, account_id, observed_at):
        bundle = await self.convex.command(
            "getDependencySafetyProjection", strategyAccountId=account_id)
        if not isinstance(bundle, dict) or set(bundle) != {"decisions", "health", "incidents"}:
            raise RuntimeError("Safety stream projection is unavailable")
        same = [item for item in bundle["decisions"]
            if item.get("scopeKey") == notification.scope_key
            and item.get("operation") == notification.operation.value]
        if len(same) != 1:
            raise RuntimeError("Safety stream projection is superseded or ambiguous")
        try:
            projection = SafetyProjection.model_validate(same[0])
            bindings = json.loads(projection.bindings_json)
        except Exception as exc:
            raise RuntimeError("Safety stream projection is malformed") from exc
        expected_hash = canonical_payload_digest(projection_hash_body(
            account_id=account_id, scope_key=projection.scope_key,
            operation=projection.operation, decision_id=projection.decision_id,
            decision_hash=projection.decision_hash,
            projection_revision=projection.projection_revision,
            projected_at=projection.updated_at))
        if projection.schema_version != 2 \
                or projection.strategy_account_id != account_id \
                or projection.projection_id != notification.projection_id \
                or projection.projection_hash != notification.projection_hash \
                or projection.projection_hash != expected_hash \
                or projection.projection_revision != notification.projection_revision \
                or projection.updated_at != _epoch_ms(notification.projected_at) \
                or projection.decision_id != decision.decision_id \
                or projection.decision_hash != decision.decision_hash \
                or projection.evaluated_at != _epoch_ms(decision.evaluated_at) \
                or projection.expires_at != _epoch_ms(decision.expires_at) \
                or projection.expires_at <= _epoch_ms(observed_at) \
                or projection.matrix_version != decision.matrix_version \
                or projection.mode != decision.mode or projection.outcome != decision.outcome \
                or projection.breaker_state != decision.breaker_state \
                or projection.subject_key != decision.subject_key \
                or projection.reasons != decision.reasons \
                or projection.receipt_hashes != decision.receipt_hashes \
                or projection.incident_keys != decision.incident_keys \
                or bindings != decision.bindings \
                or projection.binding_hash != decision.binding_hash \
                or projection.request_hash != decision.request_hash \
                or projection.idempotency_key != decision.idempotency_key:
            raise RuntimeError("Safety stream projection integrity is invalid")
