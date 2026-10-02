import asyncio
import inspect
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from moeazi_agent.dependency_safety_contracts import canonical_payload_digest
from moeazi_agent.evidence_lifecycle_operations import (
    operation_idempotency_key, record_access,
)
from moeazi_agent.evidence_lifecycle_identity import evaluation_owner_scope_key
from moeazi_agent.evidence_lifecycle_sink_discovery import (
    assert_discovered_coverage, discover_package, discover_source, load_sink_inventory,
)
from moeazi_agent.evidence_lifecycle_storage import EvidenceLifecycleRepository
from moeazi_agent.evaluation_storage import EvaluationRepository
from moeazi_agent import evidence_lifecycle_trace_disclosure, tracing


NOW = datetime(2026, 8, 6, tzinfo=timezone.utc)


class Result:
    def __init__(self, row=None, scalar=None): self.row, self.scalar = row, scalar
    def first(self): return self.row
    def all(self): return [] if self.row is None else (
        self.row if isinstance(self.row, list) else [self.row])
    def scalar_one(self): return self.scalar


def row(**values): return type("Row", (), values)()


def test_monitoring_float_request_hashes_are_tagged_and_nonfinite_is_rejected():
    output = {"run": {"confidence": 0.875, "disagreement": 0.125},
        "events": [{"score": -0.25}]}
    key = operation_idempotency_key("access", "analysis-round6", output)
    assert key == operation_idempotency_key("access", "analysis-round6", output)
    assert canonical_payload_digest(output)[:24] in key
    for value in (float("nan"), float("inf"), float("-inf")):
        with pytest.raises(ValueError, match="finite"):
            operation_idempotency_key("access", "analysis-round6", {"confidence": value})


class DisclosureConnection:
    def __init__(self, state, blocked=False): self.state, self.blocked = state, blocked
    async def execute(self, statement, _values):
        sql = str(statement)
        if "pg_advisory_xact_lock" in sql: return Result()
        if "FROM analysis_runs" in sql: return Result(self.state)
        if "SELECT EXISTS" in sql: return Result(scalar=self.blocked)
        raise AssertionError(sql)


@pytest.mark.asyncio
@pytest.mark.parametrize("state,blocked", [
    (None, False),
    (row(body_expires_at=NOW, lifecycle_deleted_at=None, outcome="allow",
        schedule_hash="a" * 64), False),
    (row(body_expires_at=NOW + timedelta(hours=1), lifecycle_deleted_at=NOW,
        outcome="allow", schedule_hash="a" * 64), False),
    (row(body_expires_at=NOW + timedelta(hours=1), lifecycle_deleted_at=None,
        outcome="quarantine", schedule_hash="a" * 64), False),
    (row(body_expires_at=NOW + timedelta(hours=1), lifecycle_deleted_at=None,
        outcome="allow", schedule_hash="a" * 64), True),
])
async def test_authoritative_disclosure_state_fails_closed(state, blocked):
    repository = EvidenceLifecycleRepository(object())
    with pytest.raises(RuntimeError, match="lifecycle state"):
        await repository._assert_disclosable(DisclosureConnection(state, blocked),
            "analysis-round6", "account:account-a", "access", NOW)


class AtomicConnection:
    def __init__(self):
        self.lock = asyncio.Lock(); self.operations = {}; self.decisions = set()
        self.receipt_count = 0
    async def execute(self, statement, values):
        sql = str(statement)
        if "pg_advisory_xact_lock" in sql:
            await self.lock.acquire(); return Result()
        if "FROM analysis_runs" in sql:
            return Result(row(body_expires_at=NOW + timedelta(hours=1),
                lifecycle_deleted_at=None, outcome="allow", schedule_hash="a" * 64))
        if "SELECT EXISTS" in sql: return Result(scalar=False)
        if "FROM evidence_lifecycle_operation_receipts" in sql:
            stored = self.operations.get((values["scope"], values["operation"], values["key"]))
            return Result(stored)
        if "INSERT INTO evidence_lifecycle_decisions" in sql:
            key = (values["producer"], values["sink"], values["key"])
            if key in self.decisions: return Result()
            self.decisions.add(key)
            return Result(row(decision_hash=values["hash"], input_digest=values["input"]))
        if "INSERT INTO evidence_lifecycle_operation_receipts" in sql:
            key = (values["scope"], values["operation"], values["key"])
            stored = row(request_hash=values["request"], payload=json.loads(values["payload"]))
            self.operations[key] = stored; self.receipt_count += 1
            return Result(stored)
        return Result()


class AtomicContext:
    def __init__(self, conn): self.conn = conn
    async def __aenter__(self): return self.conn
    async def __aexit__(self, *_):
        if self.conn.lock.locked(): self.conn.lock.release()


class AtomicEngine:
    def __init__(self): self.connection = AtomicConnection()
    def begin(self): return AtomicContext(self.connection)


@pytest.mark.asyncio
async def test_access_identical_concurrent_retries_are_one_atomic_receipt():
    engine = AtomicEngine(); repository = EvidenceLifecycleRepository(engine)
    output = {"run": {"confidence": 0.75, "disagreement": 0.2}}
    kwargs = dict(repository=repository, artifact_id="analysis-round6",
        account_id="account-a", viewer_subject="operator-a", output=output,
        idempotency_key="access:round6", observed_at=NOW)
    first, second = await asyncio.gather(record_access(**kwargs), record_access(**kwargs))
    assert first == second and first[1] == output
    assert engine.connection.receipt_count == 1 and len(engine.connection.decisions) == 1


class EvaluationConnection:
    def __init__(self, case_hash):
        self.lock = asyncio.Lock(); self.case_hash = case_hash; self.idempotency = None
        self.case_count = 0
    async def execute(self, statement, values):
        sql = str(statement)
        if "pg_advisory_xact_lock" in sql:
            await self.lock.acquire(); return Result()
        if "FROM evidence_lifecycle_decisions" in sql:
            return Result(row(producer="evaluation_case", purpose="evaluation",
                sink="timescale.evaluation_case", scope_kind="tenant",
                scope_key=evaluation_owner_scope_key("operator"), outcome="allow",
                expires_at=NOW + timedelta(minutes=5),
                admitted_payload_hash=self.case_hash,
                body_expires_at=NOW + timedelta(hours=1), owner_subject="operator"))
        if "FROM evaluation_case_idempotency" in sql: return Result(self.idempotency)
        if "INSERT INTO evaluation_case_idempotency" in sql:
            self.idempotency = row(request_hash=values["request_hash"],
                lifecycle_decision_hash=values["decision"])
            return Result(self.idempotency)
        if "INSERT INTO evaluation_cases" in sql:
            self.case_count += 1; return Result()
        raise AssertionError(sql)


class EvaluationEngine:
    def __init__(self, case_hash): self.connection = EvaluationConnection(case_hash)
    def begin(self): return AtomicContext(self.connection)


@pytest.mark.asyncio
async def test_evaluation_case_identical_concurrent_retries_insert_once():
    case = {"case_id": "case-round6", "experiment_id": "experiment-round6",
        "market": "BTC-USD", "case_kind": "replay", "repetition": 1,
        "market_snapshot": {"confidence": 0.7}, "evidence_snapshot": [],
        "snapshot_hash": "a" * 64, "observed_at": NOW.isoformat(), "status": "pending"}
    engine = EvaluationEngine(canonical_payload_digest(case))
    repository = EvaluationRepository(engine)
    await asyncio.gather(*(repository.save_case(case, "b" * 64) for _ in range(2)))
    assert engine.connection.case_count == 1


def test_trace_queries_hide_expired_or_deleted_bodies_without_cleanup_wait():
    source = inspect.getsource(tracing.TraceRepository)
    trace_source = inspect.getsource(evidence_lifecycle_trace_disclosure)
    assert source.count("body_expires_at > :observed") >= 2
    assert source.count("lifecycle_deleted_at IS NULL") >= 2
    assert "row.lifecycle_deleted_at is not None" in trace_source


def test_streaming_provider_dispatch_is_discovered_and_inventory_closed():
    calls = discover_source("async def invoke(client):\n await client.stream('/v1', json={})\n",
        "streaming_provider.py")
    assert len(calls) == 1 and calls[0].kind == "provider_boundary"
    inventory = load_sink_inventory(Path("agent-service/src/moeazi_agent/"
        "evidence_lifecycle_sink_inventory.json"))
    package = discover_package(Path("agent-service/src/moeazi_agent"))
    assert_discovered_coverage(package, inventory)
    mutation = discover_source("async def invoke(client):\n await client.astream('/v1')\n",
        "new_stream.py")
    with pytest.raises(AssertionError):
        assert_discovered_coverage(package + mutation, inventory)


def test_migration_quarantines_legacy_and_strips_disclosure_bodies():
    migration = Path("agent-service/migrations/010_evidence_lifecycle_boundary.sql").read_text()
    assert "evidence_legacy_copy_receipts" in migration
    assert "ORDER BY s.created_at DESC" not in migration
    assert "payload->'receipt') - 'output' - 'content'" in migration
    assert "evidence_lifecycle_command_outbox_schedule_fk" in migration
    assert "evidence_copy_receipts_schedule_fk" in migration
