from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from moeazi_agent.evaluation_lifecycle import EvaluationLifecycleGate
from moeazi_agent.evaluation_storage import EvaluationRepository
from moeazi_agent.evidence_lifecycle_contracts import CopyDispositionReceipt
from moeazi_agent.evidence_lifecycle_deletion import aggregate_deletion, digest
from moeazi_agent.evidence_lifecycle_identity import evidence_cache_key
from moeazi_agent.evidence_lifecycle_registry import SINK_OWNERS, policy_for
from moeazi_agent.evidence_lifecycle_sink_discovery import (
    assert_discovered_coverage, discover_package, discover_source, load_sink_inventory,
)
from moeazi_agent.evidence_lifecycle_storage import EvidenceLifecycleRepository
from moeazi_agent import evidence_lifecycle_workflow as workflow

NOW = datetime(2026, 8, 6, tzinfo=timezone.utc)


def _receipt(schedule_hash: str, copy_id: str, status: str):
    body = {"artifact_id": "artifact-round5", "schedule_hash": schedule_hash,
        "copy_id": copy_id, "owner_id": SINK_OWNERS[copy_id], "revision": 1,
        "predecessor_hash": None, "status": status, "evidence_reference": "fixture",
        "observed_at": NOW.isoformat()}
    value = digest(body)
    return CopyDispositionReceipt.model_validate({**body,
        "receipt_id": f"ecd_{value[:48]}", "receipt_hash": value})


def test_prior_schedule_receipts_cannot_satisfy_new_schedule():
    policy = policy_for("push_evidence", "evidence_ingest", "timescale.evidence_body")
    old, new = "a" * 64, "b" * 64
    receipts = [_receipt(old, copy_id, "not_applicable")
        for copy_id in policy.expected_copies]
    result = aggregate_deletion("artifact-round5", policy.policy_hash, new, receipts, NOW)
    assert result.outcome == "partial" and result.schedule_hash == new
    assert result.copy_receipt_hashes == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("locator,deleted", [
    ("evidence:hot:BTC:evidence-round5", 0), ("evidence:hot:ETH:evidence-round5", 1),
])
async def test_redis_adapter_never_verifies_missing_or_wrong_locator(monkeypatch, locator, deleted):
    expected = evidence_cache_key("BTC", "evidence-round5")
    command = {"command_hash": "a" * 64, "owner_id": "redis_coordination",
        "copy_id": "redis.evidence_cache", "payload": {
            "command_id": "elc_" + "a" * 48, "command_hash": "a" * 64,
            "artifact_id": "evidence-round5", "scope_key": "public",
            "schedule_hash": "b" * 64,
            "owner_id": "redis_coordination", "copy_id": "redis.evidence_cache",
            "action": "delete_copy", "revision": 1, "policy_hash": "c" * 64,
            "reason_code": "retention_due", "idempotency_key": "copy:round5:redis",
            "locator": locator, "issued_at": NOW.isoformat()}}
    class Repository:
        completed = []
        async def pending_copy_commands(self, *_): return [command]
        async def evidence_cache_locator(self, *_): return expected
        async def complete_copy_command(self, _, status, *args): self.completed.append(status)
        async def fail_copy_command(self, *_): return False
        async def aggregate_schedule(self, *_): return {"outcome": "unverifiable"}
    class Redis:
        keys = []
        async def delete(self, key): self.keys.append(key); return deleted
        async def aclose(self): pass
    repository, redis = Repository(), Redis()
    monkeypatch.setattr(workflow, "EvidenceLifecycleRepository", lambda _: repository)
    monkeypatch.setattr(workflow, "AnalysisRepository",
        lambda _: type("A", (), {"engine": object()})())
    monkeypatch.setattr(workflow, "get_settings",
        lambda: type("S", (), {"postgres_dsn": "local", "redis_url": "local"})())
    monkeypatch.setattr("redis.asyncio.Redis.from_url", lambda *_: redis)
    await workflow.execute_copy_commands_activity({"artifact_id": "evidence-round5",
        "scope_key": "public",
        "schedule_hash": "b" * 64, "observed_at": NOW.isoformat()})
    assert repository.completed == ["unverifiable"]
    assert redis.keys == ([expected] if locator == expected else [])


class _Result:
    def __init__(self, row=None, rows=None): self.row = row; self.rows = rows or []
    def first(self): return self.row
    def __iter__(self): return iter(self.rows)


class _Context:
    def __init__(self, value): self.value = value
    async def __aenter__(self): return self.value
    async def __aexit__(self, *_): return False


@pytest.mark.asyncio
async def test_operation_insert_is_atomic_and_stores_no_output_body():
    class Connection:
        row = None; lock = asyncio.Lock()
        async def execute(self, statement, values):
            sql = str(statement)
            if "INSERT INTO evidence_lifecycle_operation_receipts" in sql:
                async with self.lock:
                    if self.row: return _Result()
                    self.row = type("Row", (), {"request_hash": values["request"],
                        "payload": json.loads(values["payload"])})()
                    return _Result(self.row)
            if "SELECT request_hash,payload" in sql: return _Result(self.row)
            return _Result()
    connection = Connection()
    engine = type("E", (), {"begin": lambda self: _Context(connection)})()
    repository = EvidenceLifecycleRepository(engine)
    payload = {"receipt": {"output_hash": "d" * 64}}
    calls = [repository.save_operation("export", "eer_" + str(i) * 48,
        "artifact-round5", "account:a", str(i) * 64, payload,
        idempotency_key="export:round5", request_hash="e" * 64) for i in (1, 2)]
    first, second = await asyncio.gather(*calls)
    assert first == second == payload and "output" not in connection.row.payload


@pytest.mark.asyncio
async def test_evaluation_case_rejects_confused_worker_tenant():
    gate = EvaluationLifecycleGate(None, "experiment-round5", "BTC", NOW,
        operator_subject="owner-a")
    case = {"case_id": "case-round5", "experiment_id": "experiment-round5",
        "market": "BTC", "case_kind": "replay", "repetition": 0,
        "market_snapshot": {}, "evidence_snapshot": [], "snapshot_hash": "a" * 64,
        "observed_at": NOW.isoformat(), "status": "ready"}
    class Decisions:
        async def save_decision_bundle(self, *_): pass
    gate.repository = Decisions()
    decision, admitted = await gate.govern_case(case)
    row = type("Decision", (), {"producer": "evaluation_case", "purpose": "evaluation",
        "sink": "timescale.evaluation_case", "scope_kind": "tenant",
        "scope_key": decision.scope.key, "owner_subject": "owner-b", "outcome": "allow",
        "expires_at": decision.expires_at, "body_expires_at": decision.expires_at,
        "admitted_payload_hash": decision.sanitized_payload_hash})()
    class Connection:
        async def execute(self, *_): return _Result(row)
    engine = type("E", (), {"begin": lambda self: _Context(Connection())})()
    with pytest.raises(RuntimeError, match="binding is invalid"):
        await EvaluationRepository(engine).save_case(admitted, decision.decision_hash)


@pytest.mark.asyncio
async def test_evaluation_case_read_hides_body_at_exact_expiry_with_fake_clock():
    expires = NOW + timedelta(minutes=1)
    class Row:
        def __init__(self, value): self._mapping = value
        def __getattr__(self, name): return self._mapping[name]
    class Connection:
        async def execute(self, statement, values):
            sql = str(statement)
            if "SELECT * FROM evaluation_experiments" in sql:
                return _Result(Row({"experiment_id": "experiment-round5",
                    "customer_account_id": None}))
            if "FROM evaluation_cases" in sql:
                visible = values["visible_at"] < expires
                return _Result(rows=[Row({"case_id": "case-round5",
                    "market_snapshot": {"price": 1} if visible else {},
                    "evidence_snapshot": [{"id": 1}] if visible else []})])
            return _Result(rows=[])
    engine = type("E", (), {"connect": lambda self: _Context(Connection())})()
    repository = EvaluationRepository(engine)
    before = await repository.get_experiment("owner", "experiment-round5", NOW)
    expired = await repository.get_experiment("owner", "experiment-round5", expires)
    assert before["cases"][0]["evidence_snapshot"]
    assert expired["cases"][0]["market_snapshot"] == {}
    assert expired["cases"][0]["evidence_snapshot"] == []


def test_provider_dispatch_discovery_is_exact_and_mutation_closed():
    calls = discover_source("async def send(provider, client):\n"
        " await provider.client.responses.parse(model='x')\n"
        " await client.post('/chat/completions', json={})\n", "synthetic.py")
    assert [item.kind for item in calls] == ["provider_boundary", "provider_boundary"]
    inventory = load_sink_inventory(Path("agent-service/src/moeazi_agent/"
        "evidence_lifecycle_sink_inventory.json"))
    package = discover_package(Path("agent-service/src/moeazi_agent"))
    assert_discovered_coverage(package, inventory)
    with pytest.raises(AssertionError, match="provider_boundary|callsite inventory drifted"):
        assert_discovered_coverage(package + calls, inventory)


def test_idempotency_paths_use_dedicated_columns_not_json_lookup():
    disposition = Path("agent-service/src/moeazi_agent/"
        "evidence_lifecycle_disposition.py").read_text()
    migration = Path("agent-service/migrations/010_evidence_lifecycle_boundary.sql").read_text()
    assert "payload->>'idempotency_key'" not in disposition
    assert "ON CONFLICT (scope_key,operation,idempotency_key)" in disposition
    assert "WHERE idempotency_key IS NOT NULL" not in migration
