"""Independent Q3 financial read behavior with inert SQL and stored-state fakes."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from moeazi_agent.finance_contracts import FinanceScope
from moeazi_agent.finance_reads import FinanceReadMixin


NOW = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
SCOPE = FinanceScope(environment="experiment", scope_id="run-a",
                     strategy_account_id="acct-a")
HASH = "a" * 64


def account(**changes):
    body = dict(environment="experiment", scope_id="run-a", strategy_account_id="acct-a",
        revision=7, writer_epoch=2, authority_epoch=3,
        reconciliation_state="clean", reconciliation_reason="matched",
        observation_snapshot_hash=HASH, observed_at=NOW - timedelta(seconds=2),
        policy_version="policy-a", policy_hash=HASH)
    return body | changes


class Result:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row


class Connection:
    def __init__(self, row):
        self.row = row
        self.calls = 0

    async def execute(self, statement, params):
        assert "finance_policy_versions" in str(statement)
        assert params["strategy_account_id"] == "acct-a"
        self.calls += 1
        return Result(self.row)


@pytest.mark.asyncio
@pytest.mark.parametrize("changes,stored,reason", [
    ({"observed_at": None}, True, "observation_unavailable"),
    ({"observed_at": NOW + timedelta(seconds=1)}, True, "observation_in_future"),
    ({"observed_at": NOW - timedelta(seconds=11)}, True, "stale_observation"),
    ({}, False, "policy_unavailable"),
    ({}, "bad_hash", "policy_unavailable"),
])
async def test_read_state_reduces_authority_without_mutating_persisted_record(
        monkeypatch, changes, stored, reason):
    from moeazi_agent import finance_reads
    valid = SimpleNamespace(policy_hash=HASH, policy_version="policy-a",
                            max_observation_age_seconds=10)
    monkeypatch.setattr(finance_reads.SizingPolicy, "model_validate", lambda _raw: valid)
    row = None if stored is False else {
        "policy_hash": "b" * 64 if stored == "bad_hash" else HASH,
        "policy_json": {"fixture": "checked by mocked policy parser"}}
    conn = Connection(row)
    persisted = account(**changes)
    view = await FinanceReadMixin()._read_state(conn, SCOPE, persisted, NOW)
    assert view["reconciliation_state"] == "unknown"
    assert view["reconciliation_reason"] == reason
    assert persisted["reconciliation_state"] == "clean"
    assert persisted["reconciliation_reason"] == "matched"
    assert view["observed_at"] == persisted["observed_at"]
    assert conn.calls == (0 if reason.startswith("observation_") else 1)


class Context:
    def __init__(self):
        self.conn = object()

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, *_args):
        return False


class Reader(FinanceReadMixin):
    def __init__(self, limit=1, held=2):
        self.engine = SimpleNamespace(begin=Context)
        self.limit, self.held = limit, held

    async def _lock(self, _conn, _scope):
        return account()

    async def _db_now(self, _conn):
        return NOW

    async def _read_state(self, _conn, _scope, state, _now):
        return state

    async def _projection_rows(self, _conn, _scope):
        return ([], [dict(reservation_id="hold-a", status="uncertain",
            capacity_key="asset:a:b:c", asset_unit_id="a:b", location_id="c",
            units=self.held)], [dict(capacity_key="asset:a:b:c",
            asset_unit_id="a:b", location_id="c", limit_units=self.limit)])


@pytest.mark.asyncio
async def test_retained_hold_deficit_quarantines_read_without_erasing_hold():
    reader = Reader(limit=1, held=2)
    value = await reader.read_account_risk_snapshot(SCOPE)
    assert value["capacity"][0]["availableUnits"] == "-1"
    assert value["holds"][0]["status"] == "uncertain"
    assert value["reconciliationState"] == "quarantined"
    assert value["reconciliationReason"] == "capacity_deficit"
    assert value["observedAt"] == "2026-09-30T11:59:58.000Z"
    assert value["asOf"] == "2026-09-30T12:00:00.000Z"
    withdrawn = await reader.read_withdrawable_balance(SCOPE, "a:b", "c")
    assert withdrawn["status"] == "unknown" and withdrawn["units"] is None


@pytest.mark.asyncio
async def test_withdrawable_uses_exact_asset_location_and_reports_genuine_zero():
    reader = Reader(limit=2, held=2)
    collision = await reader.read_withdrawable_balance(SCOPE, "a", "b:c")
    assert collision["status"] == "unknown" and collision["units"] is None
    assert collision["reason"] == "capacity_unavailable"
    exact = await reader.read_withdrawable_balance(SCOPE, "a:b", "c")
    assert exact["status"] == "available" and exact["units"] == "0"
