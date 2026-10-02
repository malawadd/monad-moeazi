"""Stored native account evidence required before live financial admission."""

from sqlalchemy import text

from .account_observation_storage import account_snapshot_hash
from .finance_contracts import FinanceError
from .finance_observation_contracts import (
    account_snapshot_from_row, require_current_live_native_snapshot,
)


async def require_live_finance_authority(conn, scope, account, policy, now):
    if scope.environment != "live":
        return
    if not policy.approved_live or not account["source_account_id"] \
            or not account["observation_snapshot_hash"]:
        raise FinanceError("live account policy or native observation is unavailable")
    row = (await conn.execute(text("""
        SELECT * FROM observation_account_snapshots
        WHERE snapshot_hash=:hash AND environment='live' AND scope_id='live'
          AND strategy_account_id=:strategy_account_id
    """), {"hash": account["observation_snapshot_hash"],
           "strategy_account_id": scope.strategy_account_id})).mappings().first()
    if row is None:
        raise FinanceError("stored live account observation is unavailable")
    snapshot = account_snapshot_from_row(row)
    if account_snapshot_hash(snapshot) != snapshot.snapshot_hash:
        raise FinanceError("stored live account observation hash differs")
    require_current_live_native_snapshot(snapshot, scope=scope,
        source_account_id=account["source_account_id"],
        policy_version=policy.policy_version, now=now,
        max_age_seconds=policy.max_observation_age_seconds)
