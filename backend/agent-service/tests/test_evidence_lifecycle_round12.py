import asyncio
import copy
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent import test_center, test_center_controls_api
from moeazi_agent.dependency_safety_contracts import canonical_payload_digest
from moeazi_agent.evidence_lifecycle_storage import EvidenceLifecycleRepository
from moeazi_agent.evidence_lifecycle_contracts import LifecycleScope
from moeazi_agent.evidence_lifecycle_evaluator import evaluate_persistence

FEATURE_1 = "dependency-safety-envelope"
FEATURE_3 = "evidence-lifecycle-boundary"
FEATURE_14 = "verified-strategy-termination"
SCHEMA = "feature03_round12_disclosure"
RUN_LOCAL = os.getenv("MOEAZI_RUN_LOCAL_POSTGRES_TESTS") == "1"
DSN = os.getenv("MOEAZI_LOCAL_POSTGRES_DSN",
    os.getenv("POSTGRES_DSN",
        "postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/moeazi"))


class NoReadRedis:
    async def get(self, _key):
        raise RuntimeError("Redis unavailable")


def forged_loader(original, availability, verification, test_center_state):
    def load(name):
        value = copy.deepcopy(original(name))
        if name == "feature_registry.json":
            feature = next(item for item in value["features"] if item["id"] == FEATURE_3)
            feature["availability"] = availability
            feature["implementationVerification"] = verification
            feature["testCenter"] = test_center_state
        return value
    return load


@pytest.mark.asyncio
async def test_safe_defaults_derive_only_from_canonical_release_state(monkeypatch):
    assert test_center.safe_default_state(FEATURE_1)["effectiveMode"] == "off"
    assert test_center.safe_default_state(FEATURE_3)["effectiveMode"] == "off"
    with pytest.raises(TypeError):
        test_center.safe_default_state(True, FEATURE_3)
    original = test_center.load_json
    for availability, verification, test_center_state in (
            ("available", "Pending", "Isolated enforce"),
            ("unavailable", "PASS", "Isolated enforce"),
            ("available", "PASS", "Unavailable")):
        monkeypatch.setattr(test_center, "load_json",
            forged_loader(original, availability, verification, test_center_state))
        state = test_center.safe_default_state(FEATURE_3)
        assert state["requestedMode"] == state["effectiveMode"] == "unavailable"
        assert (await test_center.get_controls(
            NoReadRedis(), "operator", FEATURE_3))["effectiveMode"] == "unavailable"
    monkeypatch.setattr(test_center, "load_json", original)


@pytest.mark.asyncio
async def test_verified_deferred_audit_feature_api_state_is_safe_off(monkeypatch):
    monkeypatch.setattr(test_center_controls_api, "identity", lambda *_args: "operator")
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(redis=NoReadRedis())))
    state = await test_center_controls_api.state(FEATURE_14, request, None, None, None)
    assert state["requestedMode"] == state["effectiveMode"] == "off"
    registry = test_center_controls_api.registry_response()
    feature = next(item for item in registry["features"] if item["id"] == FEATURE_14)
    assert feature["audit"] == "Reviewed — archived privately"
    assert feature["productAvailability"] == "unavailable"


def test_disclosure_sql_has_exact_cardinality_and_locking_without_windows():
    source = (Path(__file__).resolve().parents[1] / "src/moeazi_agent/"
        "evidence_lifecycle_disclosure.py").read_text(encoding="utf-8")
    trace_source = (Path(__file__).resolve().parents[1] / "src/moeazi_agent/"
        "evidence_lifecycle_trace_disclosure.py").read_text(encoding="utf-8")
    assert "count(*) OVER" not in source
    assert "LIMIT 2 FOR UPDATE OF a" in source
    assert "FOR UPDATE OF t" in trace_source
    assert "async with self.engine.begin() as conn" in source


async def create_schema(admin):
    async with admin.begin() as conn:
        await conn.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"))
        await conn.execute(text(f"CREATE SCHEMA {SCHEMA}"))
        await conn.execute(text(f"""
            CREATE TABLE {SCHEMA}.analysis_runs (
              scope_key text NOT NULL, analysis_id text NOT NULL, account_id text NOT NULL,
              created_at timestamptz NOT NULL, body_expires_at timestamptz,
              lifecycle_deleted_at timestamptz, lifecycle_decision_hash text NOT NULL)
        """))
        await conn.execute(text(f"""
            CREATE TABLE {SCHEMA}.agent_trace_events (
              scope_key text NOT NULL, analysis_id text NOT NULL, event_id text NOT NULL,
              created_at timestamptz NOT NULL, lifecycle_deleted_at timestamptz,
              lifecycle_admitted_body text, lifecycle_decision_hash text NOT NULL)
        """))
        await conn.execute(text(
            f"SELECT create_hypertable('{SCHEMA}.analysis_runs','created_at')"))
        await conn.execute(text(
            f"SELECT create_hypertable('{SCHEMA}.agent_trace_events','created_at')"))
        await conn.execute(text(f"""
            CREATE TABLE {SCHEMA}.evidence_lifecycle_decisions (
              decision_hash text NOT NULL, scope_key text NOT NULL, payload jsonb NOT NULL,
              outcome text NOT NULL, admitted_payload_hash text, policy_hash text NOT NULL)
        """))
        await conn.execute(text(f"""
            CREATE TABLE {SCHEMA}.evidence_retention_schedules (
              schedule_hash text NOT NULL, scope_key text NOT NULL, artifact_id text NOT NULL,
              policy_hash text NOT NULL, body_expires_at timestamptz NOT NULL,
              payload jsonb NOT NULL)
        """))
        await conn.execute(text(f"CREATE TABLE {SCHEMA}.evidence_lifecycle_tombstones "
            "(artifact_id text,scope_key text)"))
        await conn.execute(text(f"CREATE TABLE {SCHEMA}.evidence_lifecycle_holds "
            "(artifact_id text,scope_key text,starts_at timestamptz,expires_at timestamptz)"))
        await conn.execute(text(f"CREATE TABLE {SCHEMA}.evidence_copy_receipts "
            "(receipt_id text,artifact_id text,scope_key text,schedule_hash text,copy_id text,"
            "owner_id text,revision int,predecessor_hash text,receipt_hash text,status text,"
            "observed_at timestamptz,payload jsonb)"))


async def seed_authority(engine, artifact, created, *, trace_rows=0):
    scope = "account:round12-account"
    body = json.dumps({"account_id": "round12-account", "analysis_id": artifact,
        "event_id": f"event-{artifact}", "created_at": created.isoformat(),
        "output_summary": {"state": "governed"}}, sort_keys=True, separators=(",", ":"))
    decision, admitted, _, schedule = evaluate_persistence(producer="trace_event",
        purpose="monitoring", sink="timescale.agent_trace",
        scope=LifecycleScope(kind="account", key=scope,
            strategy_account_id="round12-account"),
        payload={"event_id": f"event-{artifact}", "content": body},
        artifact_id=artifact, idempotency_key=f"round12:{artifact}",
        observed_at=created)
    body = str(admitted["content"])
    async with engine.begin() as conn:
        await conn.execute(text("INSERT INTO evidence_retention_schedules "
            "(schedule_hash,scope_key,artifact_id,policy_hash,body_expires_at,payload) VALUES "
            "(:schedule,:scope,:artifact,:policy,:expires,CAST(:payload AS jsonb))"),
            {"schedule": schedule.schedule_hash, "scope": scope, "artifact": artifact,
            "policy": schedule.policy_hash, "expires": schedule.body_expires_at,
            "payload": schedule.model_dump_json()})
        await conn.execute(text("INSERT INTO evidence_lifecycle_decisions "
            "(decision_hash,scope_key,payload,outcome,admitted_payload_hash,policy_hash) VALUES "
            "(:decision,:scope,CAST(:payload AS jsonb),'allow',:admitted,:policy)"),
            {"decision": decision.decision_hash, "scope": scope,
                "payload": decision.model_dump_json(),
                "admitted": decision.sanitized_payload_hash,
                "policy": decision.policy_hash})
        await conn.execute(text("INSERT INTO analysis_runs VALUES "
            "(:scope,:artifact,'round12-account',:created,:expires,NULL,:decision)"),
            {"scope": scope, "artifact": artifact, "created": created,
                "expires": schedule.body_expires_at, "decision": decision.decision_hash})
        for _ in range(trace_rows):
            await conn.execute(text("INSERT INTO agent_trace_events VALUES "
                "(:scope,:artifact,:event,:created,NULL,:body,:decision)"),
                {"scope": scope, "artifact": artifact, "event": f"event-{artifact}",
                    "created": created, "body": body,
                    "decision": decision.decision_hash})
    return decision.decision_hash, body


@pytest.mark.skipif(not RUN_LOCAL, reason="explicit local PostgreSQL gate")
@pytest.mark.asyncio
async def test_real_timescale_disclosure_paths_cardinality_and_row_lock():
    admin = create_async_engine(DSN)
    await create_schema(admin)
    engine = create_async_engine(DSN, connect_args={"server_settings": {
        "search_path": f"{SCHEMA},public"}})
    repository = EvidenceLifecycleRepository(engine)
    now = datetime.now(timezone.utc)
    scope = "account:round12-account"
    try:
        decision, body = await seed_authority(engine, "run-success", now, trace_rows=1)
        async with engine.begin() as conn:
            await repository._assert_disclosable(conn,
                "monitoring:runs:round12-account", scope, "access", now,
                ["run-success"])
            await repository._assert_disclosable(conn, "run-success", scope, "access", now)
            await repository._assert_disclosable(conn, "run-success", scope, "export", now)
        assert await repository.stream_trace_body("run-success", "event-run-success",
            now, decision, scope, now) == body
        async with engine.begin() as conn:
            with pytest.raises(RuntimeError, match="ambiguous or unavailable"):
                await repository._assert_single_artifact(conn, "missing-run", scope, now)
        duplicate_decision, _ = await seed_authority(engine, "duplicate-run", now)
        async with engine.begin() as conn:
            await conn.execute(text("INSERT INTO analysis_runs VALUES "
                "(:scope,'duplicate-run','round12-account',:created,:expires,NULL,:decision)"),
                {"scope": scope, "created": now + timedelta(microseconds=1),
                    "expires": now + timedelta(hours=1),
                    "decision": duplicate_decision})
            with pytest.raises(RuntimeError, match="ambiguous"):
                await repository._assert_single_artifact(conn, "duplicate-run", scope, now)
        trace_decision, _ = await seed_authority(engine, "duplicate-trace", now, trace_rows=2)
        with pytest.raises(RuntimeError, match="ambiguous"):
            await repository.stream_trace_body("duplicate-trace", "event-duplicate-trace",
                now, trace_decision, scope, now)
        await seed_authority(engine, "locked-run", now)
        async with engine.begin() as locked:
            await repository._assert_single_artifact(locked, "locked-run", scope, now)
            async def mutate():
                async with engine.begin() as other:
                    await other.execute(text("UPDATE analysis_runs SET lifecycle_deleted_at=:at "
                        "WHERE analysis_id='locked-run' AND scope_key=:scope"),
                        {"at": now, "scope": scope})
            task = asyncio.create_task(mutate())
            await asyncio.sleep(0.2)
            assert not task.done()
        await asyncio.wait_for(task, timeout=2)
    finally:
        await engine.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"))
        await admin.dispose()
