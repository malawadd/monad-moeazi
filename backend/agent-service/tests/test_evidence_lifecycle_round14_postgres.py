import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.dependency_safety_storage import DependencySafetyRepository
from moeazi_agent.dependency_safety_stream import (
    DependencySafetyStreamDisclosure, build_safety_notification,
    projection_hash_body,
)
from moeazi_agent.dependency_safety_contracts import (
    DependencyStatus, SafetyOperation, SafetyScope, canonical_payload_digest,
    decision_hash_body, digest,
)
from moeazi_agent.dependency_safety_matrix import build_receipt, evaluate_safety


RUN_LOCAL = os.getenv("MOEAZI_RUN_LOCAL_POSTGRES_TESTS") == "1"
DSN = os.getenv("MOEAZI_TEST_POSTGRES_DSN", os.getenv("POSTGRES_DSN",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/moeazi"))
SCHEMA = "feature03_round14"
ACCOUNT = "round14-postgres"
TABLES = ("safety_envelope_decisions", "evidence_lifecycle_decisions",
    "evidence_transform_receipts", "evidence_retention_schedules",
    "evidence_lifecycle_outbox", "evidence_lifecycle_operation_receipts",
    "evidence_lifecycle_holds", "evidence_lifecycle_tombstones",
    "evidence_copy_receipts")


def _decision(now):
    scope = SafetyScope(kind="account", key=f"account:{ACCOUNT}",
        strategy_account_id=ACCOUNT)
    receipt = build_receipt("convex_product_state", scope, DependencyStatus.HEALTHY,
        now, "fixture_healthy", "round14-r1", "round14-v1", "round14-postgres")
    return evaluate_safety(SafetyOperation.RENDER_PREVIOUS, scope, "render:postgres",
        [receipt], {"market": "BTC", "snapshot_hash": "a" * 64},
        "round14:postgres", now, "enforce", request_hash="b" * 64)


def _invalid_binding_decision(now):
    value = _decision(now).model_copy(update={
        "binding_hash": "0" * 64, "idempotency_key": "round15:invalid-binding"})
    outer_hash = digest(decision_hash_body(value))
    return value.model_copy(update={
        "decision_hash": outer_hash, "decision_id": f"sed_{outer_hash[:48]}"})


def _confidential_reason_decision(now):
    value = _decision(now).model_copy(update={
        "breaker_state": "open", "outcome": "block",
        "reasons": ["open:convex_product_state:confidential_marker_do_not_emit"],
        "idempotency_key": "round16:unsafe-reason"})
    outer_hash = digest(decision_hash_body(value))
    return value.model_copy(update={
        "decision_hash": outer_hash, "decision_id": f"sed_{outer_hash[:48]}"})


def _projection(decision, revision=1):
    projected_at = int((decision.evaluated_at + timedelta(seconds=1)).timestamp() * 1000)
    body = projection_hash_body(account_id=ACCOUNT, scope_key=decision.scope.key,
        operation=decision.operation, decision_id=decision.decision_id,
        decision_hash=decision.decision_hash, projection_revision=revision,
        projected_at=projected_at)
    return {"_id": "round14-projection", "_creationTime": float(projected_at),
        "schemaVersion": 2, "strategyAccountId": ACCOUNT,
        "operation": decision.operation.value, "subjectKey": decision.subject_key,
        "scopeKey": decision.scope.key, "mode": decision.mode,
        "breakerState": decision.breaker_state, "outcome": decision.outcome,
        "reasons": decision.reasons, "receiptHashes": decision.receipt_hashes,
        "incidentKeys": decision.incident_keys,
        "bindingsJson": __import__("json").dumps(decision.bindings, separators=(",", ":")),
        "decisionId": decision.decision_id, "decisionHash": decision.decision_hash,
        "matrixVersion": decision.matrix_version,
        "evaluatedAt": int(decision.evaluated_at.timestamp() * 1000),
        "expiresAt": int(decision.expires_at.timestamp() * 1000),
        "idempotencyKey": decision.idempotency_key,
        "bindingHash": decision.binding_hash, "requestHash": decision.request_hash,
        "projectionRevision": revision,
        "projectionHash": canonical_payload_digest(body), "updatedAt": projected_at}


class Convex:
    def __init__(self, projection, supersede_after=None):
        self.projection = projection; self.calls = 0
        self.supersede_after = supersede_after
    async def command(self, name, **payload):
        assert name == "getDependencySafetyProjection"
        assert payload == {"strategyAccountId": ACCOUNT}
        self.calls += 1
        value = self.projection
        if self.supersede_after and self.calls >= self.supersede_after:
            value = {**value, "decisionHash": "f" * 64}
        return {"decisions": [value], "health": [], "incidents": []}


async def _schema(admin):
    async with admin.begin() as conn:
        await conn.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"))
        await conn.execute(text(f"CREATE SCHEMA {SCHEMA}"))
        for table in TABLES:
            await conn.execute(text(
                f"CREATE TABLE {SCHEMA}.{table} (LIKE public.{table} INCLUDING ALL)"))
        await conn.execute(text(f"CREATE UNIQUE INDEX round14_operation_idempotency ON "
            f"{SCHEMA}.evidence_lifecycle_operation_receipts"
            "(scope_key,operation,idempotency_key)"))


@pytest.mark.skipif(not RUN_LOCAL, reason="explicit local PostgreSQL gate")
@pytest.mark.asyncio
async def test_real_safety_stream_authority_access_receipt_and_post_read_supersession():
    admin = create_async_engine(DSN)
    await _schema(admin)
    engine = create_async_engine(DSN, connect_args={"server_settings": {
        "search_path": f"{SCHEMA},public"}})
    now = datetime.now(timezone.utc).replace(microsecond=123000)
    value = _decision(now); projected = _projection(value)
    notification = build_safety_notification(value, {
        "projectionId": projected["_id"],
        "projectionHash": projected["projectionHash"],
        "projectionRevision": projected["projectionRevision"],
        "projectedAt": projected["updatedAt"]})
    try:
        await DependencySafetyRepository(engine).save_bundle([], value)
        output = await DependencySafetyStreamDisclosure(engine,
            Convex(projected)).disclose(notification, ACCOUNT, "viewer-postgres",
                now + timedelta(seconds=2))
        assert output["decision_hash"] == value.decision_hash
        async with engine.connect() as conn:
            receipts = (await conn.execute(text("""
                SELECT payload FROM evidence_lifecycle_operation_receipts
                WHERE artifact_id=:artifact AND scope_key=:scope AND operation='access'
            """), {"artifact": f"monitoring:safety:{ACCOUNT}",
                "scope": f"account:{ACCOUNT}"})).all()
        assert len(receipts) == 1 and set(receipts[0].payload) == {"receipt"}
        with pytest.raises(RuntimeError, match="projection"):
            await DependencySafetyStreamDisclosure(engine,
                Convex(projected, supersede_after=2)).disclose(
                    notification, ACCOUNT, "viewer-postgres", now + timedelta(seconds=2))
        forged = _invalid_binding_decision(now)
        forged_projection = _projection(forged, revision=2)
        forged_notification = build_safety_notification(forged, {
            "projectionId": forged_projection["_id"],
            "projectionHash": forged_projection["projectionHash"],
            "projectionRevision": forged_projection["projectionRevision"],
            "projectedAt": forged_projection["updatedAt"]})
        await DependencySafetyRepository(engine).save_bundle([], forged)
        with pytest.raises(RuntimeError, match="durable decision integrity"):
            await DependencySafetyStreamDisclosure(engine,
                Convex(forged_projection)).disclose(forged_notification, ACCOUNT,
                    "viewer-postgres", now + timedelta(seconds=2))
        async with engine.connect() as conn:
            after_forgery = (await conn.execute(text("""
                SELECT count(*) FROM evidence_lifecycle_operation_receipts
                WHERE artifact_id=:artifact AND scope_key=:scope AND operation='access'
            """), {"artifact": f"monitoring:safety:{ACCOUNT}",
                "scope": f"account:{ACCOUNT}"})).scalar_one()
        assert after_forgery == 1
        confidential = _confidential_reason_decision(now)
        confidential_projection = _projection(confidential, revision=3)
        confidential_notification = build_safety_notification(confidential, {
            "projectionId": confidential_projection["_id"],
            "projectionHash": confidential_projection["projectionHash"],
            "projectionRevision": confidential_projection["projectionRevision"],
            "projectedAt": confidential_projection["updatedAt"]})
        await DependencySafetyRepository(engine).save_bundle([], confidential)
        with pytest.raises(RuntimeError, match="durable decision integrity"):
            await DependencySafetyStreamDisclosure(engine,
                Convex(confidential_projection)).disclose(
                    confidential_notification, ACCOUNT, "viewer-postgres",
                    now + timedelta(seconds=2))
        async with engine.connect() as conn:
            after_confidential = (await conn.execute(text("""
                SELECT count(*) FROM evidence_lifecycle_operation_receipts
                WHERE artifact_id=:artifact AND scope_key=:scope AND operation='access'
            """), {"artifact": f"monitoring:safety:{ACCOUNT}",
                "scope": f"account:{ACCOUNT}"})).scalar_one()
        assert after_confidential == 1
        async with engine.begin() as conn:
            await conn.execute(text("""
                UPDATE safety_envelope_decisions SET subject_key='tampered'
                WHERE decision_hash=:hash
            """), {"hash": value.decision_hash})
        with pytest.raises(RuntimeError, match="durable decision"):
            await DependencySafetyStreamDisclosure(engine, Convex(projected)).disclose(
                notification, ACCOUNT, "viewer-postgres", now + timedelta(seconds=2))
    finally:
        await engine.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"))
        await admin.dispose()
