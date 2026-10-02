"""Offline source qualification and durable-store tests for managed pair evidence."""
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import json

import pytest
from pydantic import ValidationError

from moeazi_agent.account_observation_storage import (
    AccountObservationConflict, AccountObservationRepository, account_snapshot_hash,
)
from moeazi_agent.arbitrum_managed_pair_observation import (
    build_arbitrum_managed_pair_snapshot,
)
from moeazi_agent.finance_contracts import FinanceError, FinanceScope
from moeazi_agent.finance_observation_contracts import (
    ARBITRUM_MANAGED_PAIR_COVERAGE, ARBITRUM_USDC_UNIT_ID,
    ARBITRUM_WETH_UNIT_ID, ObservedBalance, arbitrum_managed_pair_registry_hash,
    require_current_live_native_snapshot, snapshot_coverage_is_complete,
)


OWNER = "0x1234567890abcdef1234567890abcdef12345678"
OTHER = "0xabcdef1234567890abcdef1234567890abcdef12"
NOW = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)
SCOPE = FinanceScope(environment="live", scope_id="live", strategy_account_id="dev-account")


def sidecar_read(**changes):
    return {
        "chainId": 42161,
        "account": OWNER,
        "blockNumber": "123456789",
        "blockHash": "0x" + "ab" * 32,
        "blockTimestamp": str(int((NOW - timedelta(seconds=12)).timestamp())),
        "accountMode": "kernel-7702",
        "balances": {"USDC": "9007199254740993123", "WETH": "40000000000000001"},
        "trackedPairComplete": True,
        "balancesComplete": False,
        "positionsComplete": False,
        "source": "arbitrum_finalized_rpc",
    } | changes


def managed_snapshot(**changes):
    return build_arbitrum_managed_pair_snapshot(sidecar_read(), scope=SCOPE,
        expected_account=OWNER, policy_version="dev-managed-pair-v1",
        received_at=NOW, **changes)


def test_sidecar_read_builds_exact_finalized_managed_pair_snapshot():
    snapshot = managed_snapshot()

    assert snapshot.coverage_scope == ARBITRUM_MANAGED_PAIR_COVERAGE
    assert snapshot.status == "accepted" and snapshot.origin == "native_verified"
    assert snapshot.finality == "admitted_final" and snapshot.finality_at == NOW
    assert snapshot.balances_complete is True
    # The narrower scope explicitly keeps all other assets and positions out.
    assert snapshot.positions_complete is False and snapshot.observed_positions == ()
    assert snapshot.source_account_id == f"arbitrum:42161:wallet:{OWNER}"
    assert snapshot.source_block_number == "123456789"
    assert snapshot.source_block_hash == "0x" + "ab" * 32
    assert {row.asset_unit_id for row in snapshot.observed_balances} == {
        ARBITRUM_USDC_UNIT_ID, ARBITRUM_WETH_UNIT_ID,
    }
    assert next(row for row in snapshot.observed_balances
                if row.asset_unit_id == ARBITRUM_USDC_UNIT_ID).units == "9007199254740993123"
    assert snapshot.registry_hash == arbitrum_managed_pair_registry_hash()
    assert snapshot_coverage_is_complete(snapshot)
    assert account_snapshot_hash(snapshot) == snapshot.snapshot_hash
    assert require_current_live_native_snapshot(snapshot, scope=SCOPE,
        source_account_id=snapshot.source_account_id, policy_version="dev-managed-pair-v1",
        now=NOW, max_age_seconds=60) == snapshot


@pytest.mark.parametrize("changes", [
    {"chainId": 10},
    {"trackedPairComplete": False},
    {"balancesComplete": True},
    {"positionsComplete": True},
    {"blockHash": "0x1234"},
    {"account": OTHER},
    {"balances": {"USDC": "01", "WETH": "0"}},
    {"extra": "unrecognized sidecar field"},
])
def test_sidecar_response_drift_and_incomplete_scope_fail_closed(changes):
    with pytest.raises((ValidationError, FinanceError, ValueError)):
        build_arbitrum_managed_pair_snapshot(sidecar_read(**changes), scope=SCOPE,
            expected_account=OWNER, policy_version="dev-managed-pair-v1", received_at=NOW)


def test_managed_coverage_cannot_claim_full_wallet_or_positions():
    good = managed_snapshot()
    body = good.model_dump()
    body["positions_complete"] = True
    with pytest.raises(ValidationError, match="scope is misstated"):
        type(good).model_validate(body)

    body = good.model_dump()
    body["observed_balances"] = tuple(body["observed_balances"]) + (
        ObservedBalance(asset_unit_id="arbitrum:42161:erc20:other:18:v1",
            location_id=good.source_account_id, book="wallet", units="1",
            registry_hash=good.registry_hash).model_dump(),
    )
    with pytest.raises(ValidationError, match="exactly the pair wallet balances"):
        type(good).model_validate(body)


def test_full_account_snapshot_hash_keeps_legacy_contract_stable():
    snapshot = managed_snapshot()
    full = snapshot.model_copy(update={"coverage_scope": "full_account"})
    body = full.model_dump(mode="json", exclude={
        "snapshot_hash", "coverage_scope", "source_block_number", "source_block_hash",
    })
    legacy = hashlib.sha256(("moeazi-account-observation-v1\n" +
        json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)).encode()).hexdigest()
    assert account_snapshot_hash(full) == legacy


class FakeResult:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row


class FakeConnection:
    def __init__(self, engine):
        self.engine = engine

    async def execute(self, statement, params):
        sql = str(statement)
        if "INSERT INTO observation_account_snapshots" in sql:
            p = params
            self.engine.row = {
                "snapshot_hash": p["hash"], "environment": p["environment"],
                "scope_id": p["scope"], "strategy_account_id": p["account"],
                "source_account_id": p["source"], "status": p["status"],
                "origin": p["origin"], "observed_balances": json.loads(p["balances"]),
                "observed_positions": json.loads(p["positions"]),
                "balances_complete": p["balances_complete"],
                "positions_complete": p["positions_complete"], "event_at": p["event_at"],
                "available_at": p["available_at"], "received_at": p["received_at"],
                "cutoff_at": p["cutoff_at"], "finality": p["finality"],
                "finality_at": p["finality_at"], "has_gap": p["has_gap"],
                "has_reorg": p["has_reorg"], "rights_ref": p["rights"],
                "source_event_hash": p["event_hash"],
                "source_payload_hash": p["payload_hash"],
                "policy_version": p["policy"], "registry_hash": p["registry_hash"],
                "coverage_scope": p["coverage_scope"],
                "source_block_number": p["source_block_number"],
                "source_block_hash": p["source_block_hash"],
            }
            return FakeResult(None)
        if "SELECT * FROM observation_account_snapshots" in sql:
            if not self.engine.row or self.engine.row["snapshot_hash"] != params["hash"]:
                return FakeResult(None)
            return FakeResult(self.engine.row)
        raise AssertionError("unexpected SQL in account observation fake")


class FakeEngine:
    def __init__(self):
        self.row = None

    @asynccontextmanager
    async def begin(self):
        yield FakeConnection(self)

    @asynccontextmanager
    async def connect(self):
        yield FakeConnection(self)


@pytest.mark.asyncio
async def test_native_snapshot_writer_roundtrips_managed_coverage_idempotently():
    snapshot = managed_snapshot()
    repository = AccountObservationRepository(FakeEngine())

    assert await repository.store_native_snapshot(snapshot) == snapshot.snapshot_hash
    loaded = await repository.load_by_hash(snapshot.snapshot_hash)
    assert loaded == snapshot


@pytest.mark.asyncio
async def test_native_snapshot_writer_does_not_accept_experiment_fixture():
    snapshot = managed_snapshot()
    experiment = snapshot.model_copy(update={"scope": FinanceScope(
        environment="experiment", scope_id="fixture", strategy_account_id="dev-account")})
    with pytest.raises(ValueError, match="Only finalized managed-pair"):
        await AccountObservationRepository(object()).store_native_snapshot(experiment)


@pytest.mark.asyncio
async def test_native_snapshot_writer_revalidates_block_binding_before_storage():
    snapshot = managed_snapshot()
    tampered = snapshot.model_copy(update={"source_block_hash": "0x" + "cd" * 32})
    tampered = tampered.model_copy(update={"snapshot_hash": account_snapshot_hash(tampered)})
    with pytest.raises(ValidationError, match="source event does not bind"):
        await AccountObservationRepository(object()).store_native_snapshot(tampered)
