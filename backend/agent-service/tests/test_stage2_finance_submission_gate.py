"""Fail-closed lookup checks; mocked rows are never native account evidence."""
from datetime import datetime, timedelta, timezone

import pytest

from moeazi_agent.finance_contracts import FinanceError, FinanceScope
from moeazi_agent.finance_observation_contracts import (
    AccountObservationSnapshotRef, ObservedBalance,
    require_current_live_native_snapshot,
)
from moeazi_agent.finance_repository import FinanceRepository


LIVE = FinanceScope(environment="live", scope_id="live", strategy_account_id="acct-live")
HASH = "a" * 64


class _Result:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row


class _Connection:
    def __init__(self, row):
        self.row = row
        self.statement = ""
        self.parameters = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def execute(self, statement, parameters):
        self.statement = str(statement)
        self.parameters = parameters
        return _Result(self.row)


class _Engine:
    def __init__(self, row=None):
        self.connection = _Connection(row)
        self.reads = 0

    def connect(self):
        self.reads += 1
        return self.connection


@pytest.mark.asyncio
async def test_experiment_scope_never_creates_a_gateway_live_dispatch_match():
    engine = _Engine()
    scope = FinanceScope(environment="experiment", scope_id="exp-1",
                         strategy_account_id="acct-live")
    match = await FinanceRepository(engine).verify_possible_submission(
        scope, intent_id="intent-1", client_id="cloid-1",
        normalized_payload_hash=HASH)
    assert match is None
    assert engine.reads == 0


@pytest.mark.asyncio
async def test_missing_durable_attempt_fails_closed_and_query_is_exactly_scoped():
    engine = _Engine()
    match = await FinanceRepository(engine).verify_possible_submission(
        LIVE, intent_id="intent-1", client_id="cloid-1",
        normalized_payload_hash=HASH)
    assert match is None
    assert engine.reads == 1
    assert engine.connection.parameters == {
        "environment": "live", "scope_id": "live",
        "strategy_account_id": "acct-live", "client_id": "cloid-1",
        "payload_hash": HASH, "intent_id": "intent-1",
    }
    assert "JOIN finance_reservations" in engine.connection.statement
    assert "JOIN finance_accounts" in engine.connection.statement
    assert "JOIN observation_account_snapshots" in engine.connection.statement
    assert "a.status='possible'" in engine.connection.statement
    assert "r.purpose='trade'" in engine.connection.statement
    assert "r.controller_mode IN ('approval_required','autopilot')" in engine.connection.statement


@pytest.mark.asyncio
async def test_recorded_fixture_snapshot_cannot_authorize_live_dispatch():
    now = datetime.now(timezone.utc)
    row = {
        "attempt_id": "attempt-1", "client_id": "cloid-1",
        "normalized_payload_hash": HASH, "reservation_id": "reservation-1",
        "intent_id": "intent-1", "reservation_status": "submitted",
        "reservation_snapshot_hash": HASH,
        "reservation_policy_version": "policy-1", "reservation_policy_hash": HASH,
        "reservation_authority_epoch": 3, "admission_state": "open",
        "reconciliation_state": "clean", "observation_snapshot_hash": HASH,
        "account_policy_version": "policy-1", "account_policy_hash": HASH,
        "account_authority_epoch": 3, "account_source_account_id": "fixture:acct",
        "policy_json": {}, "stored_policy_hash": HASH, "approved_live": True,
        "snapshot_hash": HASH, "environment": "live", "scope_id": "live",
        "strategy_account_id": "acct-live", "source_account_id": "fixture:acct",
        "status": "accepted", "origin": "recorded_fixture",
        "observed_balances": [], "observed_positions": [],
        "balances_complete": True, "positions_complete": True,
        "event_at": now - timedelta(seconds=1),
        "available_at": now - timedelta(seconds=1),
        "received_at": now - timedelta(seconds=1), "cutoff_at": now,
        "finality": "admitted_final", "finality_at": now - timedelta(seconds=1),
        "has_gap": False, "has_reorg": False, "rights_ref": "internal_qualification_only",
        "source_event_hash": HASH, "source_payload_hash": HASH,
        "policy_version": "policy-1", "registry_hash": HASH,
        "created_at": now, "db_now": now,
    }
    engine = _Engine(row)
    match = await FinanceRepository(engine).verify_possible_submission(
        LIVE, intent_id="intent-1", client_id="cloid-1",
        normalized_payload_hash=HASH)
    assert match is None


def test_live_snapshot_contract_rejects_experiment_only_source_rights():
    now = datetime.now(timezone.utc)
    snapshot = AccountObservationSnapshotRef(
        scope=LIVE, snapshot_hash=HASH, source_account_id="native:acct-live",
        origin="native_verified", status="accepted",
        event_at=now - timedelta(seconds=2), available_at=now - timedelta(seconds=1),
        received_at=now - timedelta(seconds=1), cutoff_at=now,
        finality_at=now - timedelta(seconds=1), finality="admitted_final",
        has_gap=False, has_reorg=False, balances_complete=True,
        positions_complete=True, rights_ref="internal_qualification_only",
        source_event_hash=HASH, source_payload_hash=HASH, registry_hash=HASH,
        policy_version="policy-1",
        observed_balances=(ObservedBalance(asset_unit_id="USDC:6", location_id="wallet",
            book="wallet", units="100", registry_hash=HASH),),
        observed_positions=(),
    )
    with pytest.raises(FinanceError, match="native account evidence"):
        require_current_live_native_snapshot(snapshot, scope=LIVE,
            source_account_id="native:acct-live", policy_version="policy-1",
            now=now, max_age_seconds=30)
