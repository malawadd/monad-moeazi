"""Q3 pending source events keep account authority blocked until replay converges."""
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from test_stage2_finance_postgres_journal import (
    journal, posting, reconcile, setup_account,
)
from test_stage2_finance_postgres_sizing import guarded_dsn


@pytest.mark.asyncio
async def test_matching_balance_observation_cannot_clear_unreplayed_source_event():
    engine = create_async_engine(guarded_dsn())
    identity = uuid4().hex
    try:
        repo, scope, epoch, snapshot, policy, revision = await setup_account(
            engine, identity, 0)
        sell = (posting("wallet", "wallet", -10),
                posting("external", "external", 10))
        queued = await repo.apply_journal_event(journal(scope, epoch, revision,
            identity, sell, source_event_id="sell", key="sell"))
        assert queued["status"] == "pending"
        # The observed zero matches the currently committed zero ledger, but a
        # known unapplied sale means that match cannot authorize new risk.
        checked = await repo.reconcile_account(reconcile(scope, epoch,
            queued["revision"], snapshot, policy, "pending-check"))
        assert checked["status"] != "clean"
        assert checked["reason"] == "pending_journal_event"
        async with engine.connect() as conn:
            row = (await conn.execute(text("SELECT reconciliation_state FROM "
                "finance_accounts WHERE scope_id=:scope"),
                {"scope": scope.scope_id})).scalar_one()
        assert row != "clean"
        buy = (posting("wallet", "wallet", 10),
               posting("external", "external", -10))
        precursor = await repo.apply_journal_event(journal(scope, epoch,
            checked["revision"], identity, buy, source_event_id="buy", key="buy"))
        applied = await repo.apply_journal_event(journal(scope, epoch,
            precursor["revision"], identity, sell, source_event_id="sell", key="sell"))
        assert applied["status"] == "applied"
        recovered = await repo.reconcile_account(reconcile(scope, epoch,
            applied["revision"], snapshot, policy, "after-replay"))
        assert recovered["status"] == "clean", recovered
        async with engine.connect() as conn:
            pending = (await conn.execute(text("SELECT count(*) FROM finance_pending_events "
                "WHERE scope_id=:scope"), {"scope": scope.scope_id})).scalar_one()
        assert pending == 0
    finally:
        await engine.dispose()
