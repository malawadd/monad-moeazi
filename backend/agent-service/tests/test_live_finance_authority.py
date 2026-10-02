from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from moeazi_agent.account_observation_storage import account_snapshot_hash
from moeazi_agent.finance_contracts import FinanceError, FinanceScope
from moeazi_agent.finance_live_authority import require_live_finance_authority
from moeazi_agent.finance_observation_contracts import (
    AccountObservationSnapshotRef, ObservedBalance,
)


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

    async def execute(self, _statement, _params):
        return Result(self.row)


def stored_native_snapshot(now, scope):
    digest = "a" * 64
    provisional = AccountObservationSnapshotRef(
        scope=scope, snapshot_hash=digest, source_account_id="native:wallet-a",
        origin="native_verified", status="accepted",
        event_at=now - timedelta(seconds=2),
        available_at=now - timedelta(seconds=1),
        received_at=now - timedelta(seconds=1), cutoff_at=now,
        finality_at=now - timedelta(seconds=1), finality="admitted_final",
        has_gap=False, has_reorg=False, balances_complete=True,
        positions_complete=True, rights_ref="native_arbitrum_rpc",
        source_event_hash=digest, source_payload_hash=digest,
        registry_hash=digest, policy_version="policy-a",
        observed_balances=(ObservedBalance(asset_unit_id="USDC:6",
            location_id="wallet-a", book="wallet", units="100000000",
            registry_hash=digest),), observed_positions=(),
    )
    snapshot = provisional.model_copy(update={
        "snapshot_hash": account_snapshot_hash(provisional)})
    row = snapshot.model_dump(mode="python")
    row.update(environment=scope.environment, scope_id=scope.scope_id,
               strategy_account_id=scope.strategy_account_id)
    row.pop("scope")
    return snapshot, row


@pytest.mark.asyncio
async def test_live_finance_requires_stored_current_native_account_evidence():
    now = datetime.now(timezone.utc)
    scope = FinanceScope(environment="live", scope_id="live",
                         strategy_account_id="account-a")
    snapshot, row = stored_native_snapshot(now, scope)
    account = {"source_account_id": snapshot.source_account_id,
               "observation_snapshot_hash": snapshot.snapshot_hash}
    policy = SimpleNamespace(approved_live=True, policy_version="policy-a",
                             max_observation_age_seconds=30)
    await require_live_finance_authority(Connection(row), scope, account,
                                         policy, now)
    with pytest.raises(FinanceError):
        await require_live_finance_authority(Connection(None), scope, account,
                                             policy, now)
    with pytest.raises(FinanceError):
        await require_live_finance_authority(Connection(row), scope, account,
            SimpleNamespace(approved_live=False, policy_version="policy-a",
                            max_observation_age_seconds=30), now)
    with pytest.raises(FinanceError):
        await require_live_finance_authority(Connection(row), scope, account,
            policy, now + timedelta(minutes=1))
