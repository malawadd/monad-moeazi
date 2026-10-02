import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from moeazi_agent.evaluation_lifecycle import EvaluationLifecycleGate
from moeazi_agent.dependency_safety_contracts import canonical_payload_digest
from moeazi_agent.evaluation_storage import EvaluationRepository
from moeazi_agent.evidence_lifecycle_deletion import LifecycleTombstone, digest
from moeazi_agent.evidence_lifecycle_operations import (
    record_access, record_local_export, validate_runtime_restore,
)
from moeazi_agent.evidence_lifecycle_sink_discovery import (
    assert_discovered_coverage, discover_package, discover_source,
)
from moeazi_agent import evidence_lifecycle_workflow as lifecycle_workflow


NOW = datetime(2026, 8, 6, tzinfo=timezone.utc)


def evaluation_case(**updates):
    value = {"case_id": "case-round4", "experiment_id": "experiment-round4",
        "market": "BTC-USD", "case_kind": "replay", "repetition": 1,
        "market_snapshot": {"price": "100", "observed_at": NOW.isoformat()},
        "evidence_snapshot": [{"ref": {"id": "evidence-1"}, "content": "safe"}],
        "snapshot_hash": "a" * 64, "observed_at": NOW.isoformat(), "status": "running"}
    return {**value, **updates}


@pytest.mark.asyncio
async def test_evaluation_case_gate_is_scoped_exact_and_blocks_secret_before_save():
    class Decisions:
        bundles = []
        async def save_decision_bundle(self, *args): self.bundles.append(args)
    gate = EvaluationLifecycleGate(None, "experiment-round4", "BTC-USD", NOW,
        operator_subject="tenant-owner")
    gate.repository = Decisions()
    decision, admitted = await gate.govern_case(evaluation_case())
    assert decision.scope.kind == "tenant" and admitted["case_id"] == "case-round4"
    assert decision.sanitized_payload_hash == canonical_payload_digest(admitted)
    with pytest.raises(RuntimeError, match="blocks evaluation case"):
        await gate.govern_case(evaluation_case(
            evidence_snapshot=[{"content": "api\\u004bey=secret"}]))
    with pytest.raises(RuntimeError, match="Raw Evaluation case"):
        await EvaluationRepository(None).save_case(evaluation_case())


@pytest.mark.asyncio
async def test_governed_case_stores_exact_admitted_body_replays_and_rejects_conflict():
    class Decisions:
        async def save_decision_bundle(self, *_): pass
    gate = EvaluationLifecycleGate(None, "experiment-round4", "BTC-USD", NOW,
        operator_subject="tenant-owner")
    gate.repository = Decisions()
    decision, admitted = await gate.govern_case(evaluation_case())
    class Result:
        def __init__(self, row=None): self.row = row; self.rowcount = 1
        def first(self): return self.row
    class Connection:
        idempotency = None; inserted = []
        async def execute(self, statement, values):
            sql = str(statement)
            if "FROM evidence_lifecycle_decisions" in sql:
                return Result(type("D", (), {"producer": "evaluation_case",
                    "purpose": "evaluation", "sink": "timescale.evaluation_case",
                    "scope_kind": "tenant", "scope_key": decision.scope.key,
                    "outcome": decision.outcome, "expires_at": decision.expires_at,
                    "body_expires_at": decision.expires_at,
                    "owner_subject": "tenant-owner",
                    "admitted_payload_hash": decision.sanitized_payload_hash})())
            if "FROM evaluation_case_idempotency" in sql:
                return Result(self.idempotency)
            if "INSERT INTO evaluation_case_idempotency" in sql:
                self.idempotency = type("I", (), {"request_hash": values["request_hash"],
                    "lifecycle_decision_hash": values["decision"]})()
                return Result(self.idempotency)
            if "INSERT INTO evaluation_cases" in sql: self.inserted.append(values)
            return Result()
    class Context:
        def __init__(self, value): self.value = value
        async def __aenter__(self): return self.value
        async def __aexit__(self, *_): return False
    connection = Connection()
    engine = type("E", (), {"begin": lambda self: Context(connection)})()
    repository = EvaluationRepository(engine)
    await repository.save_case(admitted, decision.decision_hash)
    await repository.save_case(admitted, decision.decision_hash)
    assert len(connection.inserted) == 1
    assert isinstance(connection.inserted[0]["observed_at"], datetime)
    assert json.loads(connection.inserted[0]["evidence_snapshot"]) == admitted["evidence_snapshot"]
    with pytest.raises(RuntimeError, match="binding is invalid"):
        await repository.save_case({**admitted, "status": "changed"},
            decision.decision_hash)


class OperationRepository:
    def __init__(self): self.decisions = []; self.operations = {}
    async def save_disclosure_operation(self, operation, _id, _artifact, scope, _hash,
            payload, *, idempotency_key, request_hash, decision, **_kwargs):
        key = (scope, operation, idempotency_key)
        value = self.operations.get(key)
        if value:
            if value[0] != request_hash: raise RuntimeError("conflict")
            return value[1]
        self.decisions.append(decision)
        self.operations[key] = (request_hash, payload)
        return payload


@pytest.mark.asyncio
async def test_access_export_bind_real_decisions_exact_output_retry_and_conflict():
    repository = OperationRepository()
    kwargs = {"artifact_id": "analysis-round4", "account_id": "account-a",
        "viewer_subject": "viewer-a", "output": {"summary": "safe"},
        "observed_at": NOW}
    access, accessed = await record_access(repository, **kwargs,
        idempotency_key="access:analysis-round4")
    export, exported = await record_local_export(repository, **kwargs,
        idempotency_key="export:analysis-round4")
    assert accessed == exported == kwargs["output"]
    assert access.decision_hash == repository.decisions[0].decision_hash
    assert export.decision_hash == repository.decisions[1].decision_hash
    replay, replayed = await record_local_export(repository, **{**kwargs,
        "observed_at": NOW.replace(hour=1)}, idempotency_key="export:analysis-round4")
    assert replay == export and replayed == exported and len(repository.decisions) == 2
    with pytest.raises(RuntimeError, match="conflict"):
        await record_local_export(repository, **{**kwargs, "output": {"summary": "changed"}},
            idempotency_key="export:analysis-round4")


@pytest.mark.asyncio
async def test_blocked_monitoring_output_returns_no_original_content():
    repository = OperationRepository()
    receipt, output = await record_local_export(repository, artifact_id="analysis-secret",
        account_id="account-a", viewer_subject="viewer-a",
        output={"authorization": "Bearer raw-secret"},
        idempotency_key="export:analysis-secret", observed_at=NOW)
    assert receipt.outcome == "block" and output is None


@pytest.mark.asyncio
async def test_truthful_owner_adapters_persist_terminal_receipts(monkeypatch):
    commands = [
        {"command_hash": str(i) * 64, "owner_id": owner, "copy_id": copy}
        for i, (owner, copy) in enumerate([
            ("temporal_workflows", "temporal.lifecycle_history"),
            ("external_provider", "provider.model_request"),
            ("backup_owner", "backup.lifecycle_inventory"),
            ("public_onchain", "onchain.public_reference"),
            ("redis_coordination", "redis.trace_notification"),
            ("convex_product_state", "convex.analysis_projection"),
        ], 1)]
    class Repository:
        completed = []
        async def pending_copy_commands(self, *_): return commands
        async def artifact_account(self, *_): return None
        async def complete_copy_command(self, command, status, *_):
            self.completed.append((command, status))
        async def fail_copy_command(self, *_): return False
        async def aggregate_schedule(self, *_): return {"outcome": "unverifiable"}
    repository = Repository()
    monkeypatch.setattr(lifecycle_workflow, "EvidenceLifecycleRepository", lambda _: repository)
    monkeypatch.setattr(lifecycle_workflow, "AnalysisRepository",
        lambda _: type("A", (), {"engine": object()})())
    monkeypatch.setattr(lifecycle_workflow, "get_settings",
        lambda: type("S", (), {"postgres_dsn": "local", "redis_url": "local"})())
    result = await lifecycle_workflow.execute_copy_commands_activity({
        "artifact_id": "analysis-round4", "scope_key": "public",
        "schedule_hash": "a" * 64,
        "observed_at": NOW.isoformat()})
    statuses = [item[1] for item in repository.completed]
    assert statuses == ["unverifiable", "unverifiable", "unverifiable",
        "public_onchain", "not_applicable", "unverifiable"]
    assert result["outcome"] == "unverifiable"


@pytest.mark.asyncio
async def test_redis_copy_failure_stays_pending_then_exact_retry_completes(monkeypatch):
    command = {"command_hash": "a" * 64, "owner_id": "redis_coordination",
        "copy_id": "redis.evidence_cache", "payload": {
            "command_id": "elc_" + "a" * 48, "command_hash": "a" * 64,
            "artifact_id": "evidence-round4", "scope_key": "public",
            "schedule_hash": "b" * 64,
            "owner_id": "redis_coordination", "copy_id": "redis.evidence_cache",
            "action": "delete_copy", "revision": 1, "policy_hash": "c" * 64,
            "reason_code": "retention_due", "idempotency_key": "copy:fixture:redis",
            "locator": "evidence:hot:BTC:evidence-round4",
            "issued_at": NOW.isoformat()}}
    class Repository:
        completed = False; failures = 0
        async def pending_copy_commands(self, *_): return [] if self.completed else [command]
        async def evidence_cache_locator(self, *_):
            return "evidence:hot:BTC:evidence-round4"
        async def complete_copy_command(self, *_): self.completed = True
        async def fail_copy_command(self, *_): self.failures += 1; return False
        async def aggregate_schedule(self, *_):
            return {"outcome": "verified" if self.completed else "partial"}
    class RedisClient:
        fail = True
        async def delete(self, _):
            if self.fail: raise RuntimeError("redis unavailable")
            return 1
        async def aclose(self): pass
    repository, redis = Repository(), RedisClient()
    monkeypatch.setattr(lifecycle_workflow, "EvidenceLifecycleRepository", lambda _: repository)
    monkeypatch.setattr(lifecycle_workflow, "AnalysisRepository",
        lambda _: type("A", (), {"engine": object()})())
    monkeypatch.setattr(lifecycle_workflow, "get_settings",
        lambda: type("S", (), {"postgres_dsn": "local", "redis_url": "local"})())
    monkeypatch.setattr("redis.asyncio.Redis.from_url", lambda *_: redis)
    payload = {"artifact_id": "evidence-round4", "scope_key": "public",
        "schedule_hash": "b" * 64,
        "observed_at": NOW.isoformat()}
    with pytest.raises(RuntimeError, match="redis unavailable"):
        await lifecycle_workflow.execute_copy_commands_activity(payload)
    assert repository.failures == 1 and not repository.completed
    redis.fail = False
    assert (await lifecycle_workflow.execute_copy_commands_activity(payload))["outcome"] == "verified"


@pytest.mark.asyncio
async def test_hold_projection_failure_nacks_then_success_acks(monkeypatch):
    class Repository:
        acked = []; nacked = []
        async def prepare_hold_expiry(self, *_): return {"state": "expired",
            "hold_revision": 2, "transition_hash": "b" * 64}
        async def ack_hold_expiry(self, *args): self.acked.append(args)
        async def nack_hold_expiry(self, *args): self.nacked.append(args)
    repository = Repository()
    monkeypatch.setattr(lifecycle_workflow, "EvidenceLifecycleRepository", lambda _: repository)
    monkeypatch.setattr(lifecycle_workflow, "AnalysisRepository",
        lambda _: type("A", (), {"engine": object()})())
    monkeypatch.setattr(lifecycle_workflow, "get_settings",
        lambda: type("S", (), {"postgres_dsn": "local"})())
    class Convex:
        fail = True
        async def command(self, *_args, **_kwargs):
            if self.fail: raise RuntimeError("projection unavailable")
    client = Convex()
    monkeypatch.setattr(lifecycle_workflow, "ConvexWorkerClient", lambda _: client)
    payload = {"hold_hash": "a" * 64, "artifact_id": "analysis-round4",
        "scope_key": "account:account-a", "due_at": NOW.isoformat(), "revision": 2}
    with pytest.raises(RuntimeError, match="projection unavailable"):
        await lifecycle_workflow.expire_hold_activity(payload)
    assert repository.nacked and not repository.acked
    client.fail = False
    await lifecycle_workflow.expire_hold_activity(payload)
    assert repository.acked


@pytest.mark.asyncio
async def test_corrupt_tombstones_always_quarantine_restore():
    body = {"artifact_id": "analysis-round4", "copy_id": "timescale.analysis_body",
        "cutoff_at": NOW.isoformat(), "policy_hash": "a" * 64,
        "inventory_hash": "b" * 64, "copy_receipt_hash": "c" * 64,
        "body_present": False}
    tombstone_hash = digest(body)
    with pytest.raises(ValueError):
        LifecycleTombstone.model_validate({**body,
            "tombstone_id": "elt_" + "0" * 48, "tombstone_hash": tombstone_hash})
    class Corrupt:
        async def get_tombstone(self, *_): raise RuntimeError("column mismatch")
    result = await validate_runtime_restore(Corrupt(), artifact_id="analysis-round4",
        copy_id="timescale.analysis_body", current_policy_hash="a" * 64,
        restored_policy_hash="a" * 64, inventory_hash="b" * 64,
        scope_matches=True, evaluated_at=NOW)
    assert result.outcome == "quarantine" and "deleted_body" in result.reason_codes


def test_whole_package_scanner_catches_new_file_raw_sql_and_redis_without_comments():
    calls = discover_source("async def leak(conn, redis):\n"
        " await conn.execute(text('INSERT INTO secret_dump VALUES (1)'))\n"
        " await redis.publish('raw', 'secret')\n", "new_sink.py")
    assert {item.kind for item in calls} == {"sql_write", "redis_write"}
    with pytest.raises(AssertionError): assert_discovered_coverage(calls, [])
    package_calls = discover_package(Path("agent-service/src/moeazi_agent"))
    assert any(item.function == "save_case" and item.file == "evaluation_storage.py"
        for item in package_calls)
