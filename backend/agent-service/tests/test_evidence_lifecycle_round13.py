import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.contracts import AgentRunView, EvidenceRef, SignalReport, MarketSynthesis
from moeazi_agent.evidence_lifecycle_contracts import (
    CopyDispositionReceipt, LifecycleScope,
)
from moeazi_agent.evidence_lifecycle_deletion import digest
from moeazi_agent.evidence_lifecycle_evaluator import evaluate_persistence
from moeazi_agent.evidence_lifecycle_locking import lock_lifecycle_artifacts
from moeazi_agent.evidence_lifecycle_operations import record_access, record_local_export
from moeazi_agent.evidence_lifecycle_storage import EvidenceLifecycleRepository
from moeazi_agent.storage import AnalysisRepository
from moeazi_agent.synthesis import synthesize
from moeazi_agent.tracing import TraceRepository


RUN_LOCAL = os.getenv("MOEAZI_RUN_LOCAL_POSTGRES_TESTS") == "1"
DSN = os.getenv("POSTGRES_DSN", "postgresql+asyncpg://postgres:postgres@localhost:5432/moeazi")
SCHEMA = "feature03_round13"
ACCOUNT = "round13-account"
SCOPE = f"account:{ACCOUNT}"
TABLES = (
    "evidence_lifecycle_decisions", "evidence_transform_receipts",
    "evidence_retention_schedules", "evidence_lifecycle_outbox",
    "evidence_lifecycle_operation_receipts", "evidence_lifecycle_holds",
    "evidence_lifecycle_hold_outbox", "evidence_lifecycle_tombstones",
    "evidence_copy_receipts", "evidence_lifecycle_commands",
    "evidence_lifecycle_command_outbox", "analysis_runs", "signal_reports",
    "provider_calls", "agent_trace_events", "agent_usage_daily", "evidence",
)


async def _schema(admin):
    async with admin.begin() as conn:
        await conn.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"))
        await conn.execute(text(f"CREATE SCHEMA {SCHEMA}"))
        for table in TABLES:
            await conn.execute(text(
                f"CREATE TABLE {SCHEMA}.{table} (LIKE public.{table} INCLUDING ALL)"))
        await conn.execute(text(f"CREATE UNIQUE INDEX round13_operation_idempotency ON "
            f"{SCHEMA}.evidence_lifecycle_operation_receipts"
            "(scope_key,operation,idempotency_key)"))
        await conn.execute(text(
            f"SELECT create_hypertable('{SCHEMA}.analysis_runs','created_at')"))
        await conn.execute(text(
            f"SELECT create_hypertable('{SCHEMA}.agent_trace_events','created_at')"))


def _archive(artifact: str):
    now = datetime.now(timezone.utc)
    ref = EvidenceRef(id=f"evidence-{artifact}", source="gdelt",
        uri=f"urn:round13:{artifact}", observed_at=now, event_at=now,
        quality_score=1, content_hash="a" * 64)
    report = SignalReport(role="technical", provider="deterministic", model="fixture",
        horizon="hours", stance="neutral", score=0, confidence=1, evidence=[ref],
        risks=[], expires_at=now + timedelta(minutes=5))
    call = AgentRunView(role="technical", provider="deterministic", model="fixture",
        status="completed", evidence_ids=[ref.id]).model_dump(mode="json")
    synthesis = synthesize("BTC", "focus", [report],
        [AgentRunView.model_validate(call)], 0, analysis_id=artifact)
    return synthesis, [report], [call]


async def _persist(engine, artifact: str, *, event_count: int = 1):
    synthesis, reports, calls = _archive(artifact)
    payload = {"analysis_id": artifact, "market": synthesis.market,
        "synthesis": synthesis.model_dump(mode="json"),
        "reports": [item.model_dump(mode="json") for item in reports], "calls": calls}
    scope = LifecycleScope(kind="account", key=SCOPE, strategy_account_id=ACCOUNT)
    decision, admitted, receipts, schedule = evaluate_persistence(
        producer="analysis_archive", purpose="agent_analysis",
        sink="timescale.analysis_body", scope=scope, payload=payload,
        artifact_id=artifact, idempotency_key=f"round13:archive:{artifact}",
        observed_at=synthesis.created_at)
    lifecycle = EvidenceLifecycleRepository(engine)
    await lifecycle.save_decision_bundle(decision, receipts, schedule)
    admitted_synthesis = MarketSynthesis.model_validate(admitted["synthesis"])
    admitted_reports = [SignalReport.model_validate(item) for item in admitted["reports"]]
    analysis = object.__new__(AnalysisRepository); analysis.engine = engine
    await analysis.save_run(admitted_synthesis, admitted_reports, admitted["calls"],
        "private", ACCOUNT, lifecycle_decision=decision,
        lifecycle_schedule=schedule, admitted_archive=admitted)
    traces = TraceRepository(engine)
    for index in range(event_count):
        await traces.append({"event_id": f"{artifact}:event:{index}",
            "analysis_id": artifact, "account_id": ACCOUNT,
            "event_type": "analysis", "status": "completed",
            "input_summary": {"index": index}, "output_summary": {"ok": True},
            "decision_summary": "fixture", "created_at": synthesis.created_at +
                timedelta(microseconds=index)})
    return decision, schedule


async def _assert_writer_waits(engine, artifact: str, writer):
    async with engine.begin() as conn:
        await lock_lifecycle_artifacts(conn, SCOPE, [artifact])
        task = asyncio.create_task(writer())
        await asyncio.sleep(0.2)
        assert not task.done()
    return await asyncio.wait_for(task, timeout=3)


async def _partial_receipt(engine, artifact: str, binding: dict, status: str):
    observed = datetime.now(timezone.utc)
    body = {"artifact_id": artifact, "scope_key": SCOPE,
        "schedule_hash": binding["schedule_hash"], "copy_id": "timescale.agent_trace",
        "owner_id": "timescale_history", "revision": 1, "predecessor_hash": None,
        "status": status, "evidence_reference": "round13-fixture",
        "observed_at": observed.isoformat().replace("+00:00", "Z")}
    receipt_hash = digest(body)
    receipt = CopyDispositionReceipt.model_validate({**body,
        "receipt_id": f"ecd_{receipt_hash[:48]}", "receipt_hash": receipt_hash})
    await EvidenceLifecycleRepository(engine).append_copy_receipt(
        receipt.model_dump(mode="json"))


@pytest.mark.skipif(not RUN_LOCAL, reason="explicit local PostgreSQL gate")
@pytest.mark.asyncio
async def test_real_end_to_end_disclosure_and_governing_writer_serialization():
    admin = create_async_engine(DSN)
    await _schema(admin)
    engine = create_async_engine(DSN, connect_args={"server_settings": {
        "search_path": f"{SCHEMA},public"}})
    traces = TraceRepository(engine); lifecycle = EvidenceLifecycleRepository(engine)
    try:
        await _persist(engine, "round13-success", event_count=2)
        rows = await traces.list_runs(ACCOUNT, {"days": 7, "limit": 50})
        assert [row["analysis_id"] for row in rows] == ["round13-success"]
        detail = await traces.get_trace(ACCOUNT, "round13-success")
        bindings = detail.pop("_lifecycle_bindings")
        assert len(detail["events"]) == len(bindings) == 2
        detail = json.loads(json.dumps(detail, default=str))
        access_receipt, accessed = await record_access(lifecycle, artifact_id="round13-success",
            account_id=ACCOUNT, viewer_subject="operator", output=detail,
            idempotency_key="round13:access:success",
            observed_at=datetime.now(timezone.utc), source_trace_bindings=bindings)
        assert access_receipt.outcome == "allow", access_receipt.reason_codes
        assert len(accessed["events"]) == 2
        _, exported = await record_local_export(lifecycle,
            artifact_id="round13-success", account_id=ACCOUNT,
            viewer_subject="operator", output=detail,
            idempotency_key="round13:export:success",
            observed_at=datetime.now(timezone.utc), source_trace_bindings=bindings)
        assert len(exported["events"]) == 2
        first = bindings[0]
        body = await lifecycle.stream_trace_body("round13-success", first["event_id"],
            datetime.fromisoformat(first["created_at"]), first["decision_hash"],
            SCOPE, datetime.now(timezone.utc))
        assert json.loads(body)["event_id"] == first["event_id"]

        await _persist(engine, "round13-hold")
        async def hold():
            return await lifecycle.create_or_replay_hold(artifact_id="round13-hold",
                scope_key=SCOPE, reviewer_hash="b" * 64,
                reason_code="safety_investigation", duration_seconds=600,
                idempotency_key="round13:hold", observed_at=datetime.now(timezone.utc))
        await _assert_writer_waits(engine, "round13-hold", hold)
        with pytest.raises(RuntimeError, match="blocks access"):
            await traces.get_trace(ACCOUNT, "round13-hold")

        _, delete_schedule = await _persist(engine, "round13-tombstone")
        async def tombstone():
            return await lifecycle.dispose_artifact("round13-tombstone",
                datetime.now(timezone.utc), force=True,
                schedule_hash=delete_schedule.schedule_hash, scope_key=SCOPE,
                idempotency_key="round13:delete")
        deleted = await _assert_writer_waits(engine, "round13-tombstone", tombstone)
        assert deleted["deleted"]
        with pytest.raises(RuntimeError, match="state"):
            await traces.get_trace(ACCOUNT, "round13-tombstone")

        await _persist(engine, "round13-copy")
        copy_detail = await traces.get_trace(ACCOUNT, "round13-copy")
        copy_binding = copy_detail["_lifecycle_bindings"][0]
        await _assert_writer_waits(engine, "round13-copy",
            lambda: _partial_receipt(engine, "round13-copy", copy_binding, "partial"))
        with pytest.raises(RuntimeError, match="blocks access"):
            await traces.get_trace(ACCOUNT, "round13-copy")
    finally:
        await engine.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"))
        await admin.dispose()


@pytest.mark.skipif(not RUN_LOCAL, reason="explicit local PostgreSQL gate")
@pytest.mark.asyncio
async def test_bad_trace_member_blocks_whole_detail_and_receipt():
    admin = create_async_engine(DSN)
    await _schema(admin)
    engine = create_async_engine(DSN, connect_args={"server_settings": {
        "search_path": f"{SCHEMA},public"}})
    try:
        await _persist(engine, "round13-member", event_count=2)
        trace = await TraceRepository(engine).get_trace(ACCOUNT, "round13-member")
        bindings = trace.pop("_lifecycle_bindings")
        trace = json.loads(json.dumps(trace, default=str))
        async with engine.begin() as conn:
            await lock_lifecycle_artifacts(conn, SCOPE, ["round13-member"])
            await conn.execute(text("""
                UPDATE evidence_lifecycle_decisions SET admitted_payload_hash=:forged
                WHERE decision_hash=:decision AND scope_key=:scope
            """), {"forged": "f" * 64, "decision": bindings[1]["decision_hash"],
                "scope": SCOPE})
        with pytest.raises(RuntimeError, match="authority|binding"):
            await TraceRepository(engine).get_trace(ACCOUNT, "round13-member")
        with pytest.raises(RuntimeError, match="authority|binding"):
            await record_local_export(EvidenceLifecycleRepository(engine),
                artifact_id="round13-member", account_id=ACCOUNT,
                viewer_subject="operator", output=trace,
                idempotency_key="round13:export:forged",
                observed_at=datetime.now(timezone.utc), source_trace_bindings=bindings)

        for state in ("expired", "quarantined", "missing"):
            artifact = f"round13-{state}"
            await _persist(engine, artifact)
            current = await TraceRepository(engine).get_trace(ACCOUNT, artifact)
            binding = current["_lifecycle_bindings"][0]
            async with engine.begin() as conn:
                await lock_lifecycle_artifacts(conn, SCOPE, [artifact])
                if state == "expired":
                    await conn.execute(text("""
                        UPDATE evidence_retention_schedules
                        SET body_expires_at=:expired
                        WHERE schedule_hash=:schedule AND scope_key=:scope
                    """), {"expired": datetime.now(timezone.utc) - timedelta(seconds=1),
                        "schedule": binding["schedule_hash"], "scope": SCOPE})
                elif state == "quarantined":
                    await conn.execute(text("""
                        UPDATE evidence_lifecycle_decisions SET outcome='quarantine'
                        WHERE decision_hash=:decision AND scope_key=:scope
                    """), {"decision": binding["decision_hash"], "scope": SCOPE})
                else:
                    await conn.execute(text("""
                        DELETE FROM evidence_lifecycle_decisions
                        WHERE decision_hash=:decision AND scope_key=:scope
                    """), {"decision": binding["decision_hash"], "scope": SCOPE})
            with pytest.raises(RuntimeError, match="authority|identity"):
                await TraceRepository(engine).get_trace(ACCOUNT, artifact)

        await _persist(engine, "round13-unverifiable")
        unverifiable = await TraceRepository(engine).get_trace(
            ACCOUNT, "round13-unverifiable")
        await _partial_receipt(engine, "round13-unverifiable",
            unverifiable["_lifecycle_bindings"][0], "unverifiable")
        with pytest.raises(RuntimeError, match="blocks access"):
            await TraceRepository(engine).get_trace(ACCOUNT, "round13-unverifiable")
    finally:
        await engine.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"))
        await admin.dispose()
