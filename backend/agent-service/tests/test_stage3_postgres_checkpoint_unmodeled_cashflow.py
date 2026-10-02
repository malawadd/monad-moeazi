"""An unrelated committed cashflow cannot become simulated replay P&L."""
from hashlib import sha256

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import (
    FinanceError, JournalCommand, JournalPosting,
    semantic_request_hash, source_event_digest,
)
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_postgres_atomic_fold import started


@pytest.mark.asyncio
async def test_checkpoint_refuses_extra_committed_account_cashflow():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, run, prepared, _ = await started(engine)
        await repo.fold_order_events(run.scope, run.run_id, prepared["orderId"],
            worker_id="stage2-verifier", command_id="cashflow-fold")
        params = run.scope.model_dump()
        async with engine.connect() as conn:
            account = (await conn.execute(text("""
                SELECT revision,writer_epoch FROM finance_accounts
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), params)).mappings().one()
            quote = (await conn.execute(text("""
                SELECT asset_unit_id,registry_hash,location_id
                FROM finance_capacity WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                ORDER BY limit_units DESC LIMIT 1
            """), params)).mappings().one()
            now = (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()
        legs = (
            JournalPosting(asset_unit_id=quote["asset_unit_id"],
                registry_hash=quote["registry_hash"],
                location_id=quote["location_id"], book="wallet", units="1"),
            JournalPosting(asset_unit_id=quote["asset_unit_id"],
                registry_hash=quote["registry_hash"],
                location_id="external:unmodeled", book="external", units="-1"),
        )
        identity = f"foreign-cash-{run.run_id}"
        body = dict(scope=run.scope, writer_epoch=account["writer_epoch"],
            expected_revision=account["revision"], idempotency_key=identity,
            request_hash="0" * 64, source_owner="external_fixture",
            source_stream="account_cashflow", source_event_id=identity,
            source_revision="1", source_event_hash="0" * 64,
            source_payload_hash=sha256(identity.encode()).hexdigest(),
            kind="deposit", observed_at=now, postings=legs,
            reverses_transaction_id=None)
        body["source_event_hash"] = source_event_digest(
            JournalCommand.model_construct(**body))
        body["request_hash"] = semantic_request_hash("journal",
            JournalCommand.model_construct(**body))
        event = await repo.finance.apply_journal_event(JournalCommand.model_validate(body))
        assert event["status"] == "applied"
        with pytest.raises(FinanceError, match="ledger|journal|unmodeled"):
            await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
                run.manifest_hash, worker_id="stage2-verifier",
                command_id="cashflow-checkpoint")
        async with engine.connect() as conn:
            count = (await conn.execute(text("""
                SELECT count(*) FROM simulation_derived_snapshots
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params | {"run_id": run.run_id})).scalar_one()
        assert count == 0
    finally:
        await engine.dispose()
