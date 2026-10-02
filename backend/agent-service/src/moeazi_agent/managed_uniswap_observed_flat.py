"""Proof for a stopped managed program that never acquired WETH exposure."""
from __future__ import annotations

import httpx
from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, db_native_int, native_int
from .finance_observation_contracts import (
    ARBITRUM_MANAGED_PAIR_COVERAGE, ARBITRUM_WETH_UNIT_ID,
)


async def verify_observed_flat(finance, scope: FinanceScope, context: dict,
                               snapshot) -> dict:
    """Check the finalized pair against the locked financial account and history."""
    if (scope.environment != "live" or scope.scope_id != "live"
            or context.get("strategyAccountId") != scope.strategy_account_id
            or snapshot.scope != scope
            or snapshot.coverage_scope != ARBITRUM_MANAGED_PAIR_COVERAGE
            or snapshot.origin != "native_verified"
            or snapshot.status != "accepted"
            or snapshot.finality != "admitted_final"
            or snapshot.source_account_id != context.get("sourceAccountId")
            or snapshot.source_block_number is None
            or snapshot.source_block_hash is None):
        raise FinanceError("managed zero-exposure evidence is not finalized and scoped")
    rows = [row for row in snapshot.observed_balances
            if row.asset_unit_id == ARBITRUM_WETH_UNIT_ID
            and row.location_id == snapshot.source_account_id
            and row.book == "wallet"]
    if len(rows) != 1 or native_int(rows[0].units, nonnegative=True) != 0:
        raise FinanceError("finalized managed WETH wallet is not empty")
    async with finance.engine.begin() as conn:
        account = await finance._lock(conn, scope)
        now = await finance._db_now(conn)
        view = await finance._read_state(conn, scope, account, now)
        if (account["admission_state"] != "stopped"
                or account["source_account_id"] != snapshot.source_account_id
                or account["observation_snapshot_hash"] != snapshot.snapshot_hash
                or view["reconciliation_state"] != "clean"):
            raise FinanceError("stopped managed account is not currently reconciled")
        checkpoint = (await conn.execute(text("""
          SELECT result,observation_snapshot_hash FROM finance_reconciliation_checkpoints
          WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account AND account_revision<=:revision
          ORDER BY account_revision DESC LIMIT 1
        """), {"account": scope.strategy_account_id,
               "revision": account["revision"]})).mappings().first()
        if (not checkpoint or checkpoint["result"] != "clean"
                or checkpoint["observation_snapshot_hash"] != snapshot.snapshot_hash):
            raise FinanceError("current finance revision lacks a clean native checkpoint")
        balance = (await conn.execute(text("""
          SELECT units FROM finance_balances WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account AND asset_unit_id=:asset
            AND location_id=:location AND book='wallet'
        """), {"account": scope.strategy_account_id,
               "asset": ARBITRUM_WETH_UNIT_ID,
               "location": snapshot.source_account_id})).scalar_one_or_none()
        if balance is None or db_native_int(balance) != 0:
            raise FinanceError("financial WETH wallet is not independently flat")
        unsettled = (await conn.execute(text("""
          SELECT 1 FROM finance_reservations WHERE environment='live' AND scope_id='live'
            AND strategy_account_id=:account AND purpose='trade'
            AND status IN ('reserved','submitted','uncertain') LIMIT 1
        """), {"account": scope.strategy_account_id})).first()
        possible = (await conn.execute(text("""
          SELECT 1 FROM finance_submission_attempts WHERE environment='live'
            AND scope_id='live' AND strategy_account_id=:account
            AND status='possible' LIMIT 1
        """), {"account": scope.strategy_account_id})).first()
        pending = (await conn.execute(text("""
          SELECT 1 FROM finance_pending_events WHERE environment='live'
            AND scope_id='live' AND strategy_account_id=:account LIMIT 1
        """), {"account": scope.strategy_account_id})).first()
        economic = (await conn.execute(text("""
          SELECT 1 FROM finance_source_events WHERE environment='live'
            AND scope_id='live' AND strategy_account_id=:account
            AND event_kind <> 'opening' LIMIT 1
        """), {"account": scope.strategy_account_id})).first()
        if unsettled or possible or pending or economic:
            raise FinanceError("managed account has unresolved or non-opening economics")
        return {"financeSnapshotHash": snapshot.snapshot_hash,
                "financeRevision": str(account["revision"]),
                "finalizedBlockNumber": snapshot.source_block_number,
                "finalizedBlockHash": snapshot.source_block_hash,
                "wethUnits": "0", "pendingAttemptCount": 0}


async def publish_observed_flat(settings, scope: FinanceScope,
                                context: dict, proof: dict) -> dict | None:
    worker = settings.convex_worker_url.rstrip("/")
    if not worker.endswith("/worker"):
        raise FinanceError("Convex observed-flat endpoint is not configured")
    payload = {"strategyAccountId": scope.strategy_account_id,
               "assignmentId": context["assignmentId"],
               "programVersionId": context["programVersionId"],
               "ownerAddress": context["ownerAddress"], **proof}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(worker[:-7] + "/native-finance-trade/observed-flat",
            json=payload, headers={"Authorization": "Bearer "
                + settings.worker_shared_secret.get_secret_value()})
    if not response.is_success:
        return None
    value = response.json()
    if (not isinstance(value, dict) or value.get("closureConfirmed") is not True
            or not value.get("receiptId")):
        return None
    return value
