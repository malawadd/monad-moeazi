import inspect
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from moeazi_agent.evidence_lifecycle_contracts import LifecycleScope
from moeazi_agent.evidence_lifecycle_evaluator import evaluate_persistence
from moeazi_agent.evidence_lifecycle_storage import EvidenceLifecycleRepository
from moeazi_agent import monitoring_api


NOW = datetime(2026, 8, 6, tzinfo=timezone.utc)


class Result:
    def __init__(self, row=None, scalar=None, rowcount=0):
        self.row, self.scalar, self.rowcount = row, scalar, rowcount
    def first(self): return self.row
    def all(self): return [] if self.row is None else (
        self.row if isinstance(self.row, list) else [self.row])
    def scalar_one(self): return self.scalar


def row(**values): return type("Row", (), values)()


class CollectionConnection:
    def __init__(self, states):
        self.states = states
        self.visited = []

    async def execute(self, statement, values):
        sql = str(statement)
        artifact = values.get("artifact")
        if "pg_advisory_xact_lock" in sql:
            return Result()
        if "FROM analysis_runs" in sql:
            self.visited.append(artifact)
            state = self.states[artifact]
            outcome = "quarantine" if state == "quarantined" else "allow"
            return Result(row(body_expires_at=NOW + timedelta(hours=1),
                lifecycle_deleted_at=None, outcome=outcome, schedule_hash="a" * 64))
        if "SELECT EXISTS" in sql:
            return Result(scalar=self.states[artifact] in {
                "held", "partial", "unverifiable"})
        raise AssertionError(sql)


@pytest.mark.asyncio
@pytest.mark.parametrize("blocked_state", [
    "held", "partial", "unverifiable", "quarantined",
])
async def test_monitoring_collection_rejects_one_blocked_member(blocked_state):
    connection = CollectionConnection({"a-run-safe": "allowed", "z-run-blocked": blocked_state})
    repository = EvidenceLifecycleRepository(object())
    with pytest.raises(RuntimeError, match="lifecycle state"):
        await repository._assert_disclosable(connection, "monitoring:runs:account-a",
            "account:account-a", "access", NOW, ["a-run-safe", "z-run-blocked"])
    assert connection.visited == ["a-run-safe", "z-run-blocked"]


@pytest.mark.asyncio
async def test_monitoring_collection_has_no_synthetic_identity_bypass():
    repository = EvidenceLifecycleRepository(object())
    with pytest.raises(RuntimeError, match="collection lifecycle binding"):
        await repository._assert_disclosable(CollectionConnection({}),
            "monitoring:runs:account-a", "account:account-a", "access", NOW)
    source = inspect.getsource(monitoring_api.list_runs)
    assert 'source_artifact_ids=[str(row["analysis_id"]) for row in rows]' in source


def test_same_artifact_in_two_accounts_has_distinct_schedule_identity():
    payload = {"artifact_id": "duplicate-run", "operation": "access",
        "viewer_hash": "a" * 64, "content": {"summary": "safe"}}
    schedules = []
    for account in ("account-a", "account-b"):
        _, _, _, schedule = evaluate_persistence(producer="monitoring_export",
            purpose="monitoring", sink="monitoring.evidence_output",
            scope=LifecycleScope(kind="account", key=f"account:{account}",
                strategy_account_id=account), payload=payload,
            artifact_id="duplicate-run", idempotency_key="same-user-key",
            observed_at=NOW)
        schedules.append(schedule)
    assert schedules[0].scope_key != schedules[1].scope_key
    assert schedules[0].schedule_hash != schedules[1].schedule_hash


class AccountRows:
    def __init__(self):
        self.bodies = {"account-a": "body-a", "account-b": "body-b"}
        self.calls = []

    async def execute(self, statement, values):
        sql = str(statement)
        self.calls.append((sql, dict(values)))
        account = values["account"]
        changed = int(self.bodies.get(account) is not None)
        if changed and "UPDATE analysis_runs" in sql:
            self.bodies[account] = None
        return Result(rowcount=changed)


@pytest.mark.asyncio
async def test_duplicate_artifact_disposition_cannot_cross_account_scope():
    connection = AccountRows()
    changed = await EvidenceLifecycleRepository(object())._clear_body(connection,
        "timescale.analysis_body", "a" * 64, NOW, "duplicate-run",
        "account:account-a", NOW, True)
    assert changed >= 1
    assert connection.bodies == {"account-a": None, "account-b": "body-b"}
    for sql, values in connection.calls:
        assert values["account"] == "account-a" and values["scope"] == "account:account-a"
        assert "account_id=:account" in sql or "d.scope_key=:scope" in sql


def test_scope_identity_migration_covers_lifecycle_and_evaluation_keys():
    migration = Path("agent-service/migrations/011_evidence_lifecycle_scope_identity.sql").read_text()
    assert "ADD COLUMN IF NOT EXISTS account_id" in migration
    assert "FOREIGN KEY (schedule_hash,scope_key)" in migration
    assert "UNIQUE (producer,sink,scope_key,idempotency_key)" in migration
    assert "PRIMARY KEY (scope_key,case_id)" in migration
    assert "count(DISTINCT account_id)=1" in migration
