"""Actual SQL065 source replay with immutable cursor-due event prefixes."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.lifecycle_source_replay import (
    materialize_run_events, next_due_event_cursor,
)
from test_lifecycle_preparation_postgres import guarded_dsn, setup


@pytest.mark.asyncio
async def test_source_facts_wait_for_cursor_then_survive_exact_restart_retry():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, finance, run, intent, reserved = await setup(engine)
        await repo.persist_intent(intent)
        prepared = await repo.prepare_order(intent, reserved["reservationId"], 1,
            worker_id="stage2-verifier", command_id="source-prepare")
        approved = await repo.record_simulation_approval(run.scope, run.run_id,
            run.manifest_hash, intent.intent_id, prepared["normalizedPayloadHash"],
            "verified-owner", datetime.now(timezone.utc) + timedelta(seconds=45),
            "source-approve")
        await repo.start_order(run.scope, run.run_id, prepared["orderId"],
            worker_id="stage2-verifier",
            approval_receipt_hash=approved["approvalReceiptHash"])
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        async with engine.begin() as conn:
            await finance._lock(conn, run.scope)
            await repo._run(conn, run.scope, run.run_id, lock=True)
            before = await materialize_run_events(conn, run)
            next_at = await next_due_event_cursor(conn, run,
                run.scenario.simulation_cursor_at)
            count = (await conn.execute(text("""
                SELECT count(*) FROM simulation_order_events
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
        assert before == () and count == 0
        assert next_at is not None and next_at > run.scenario.simulation_cursor_at
        assert next_at <= run.scenario.simulation_end_at

        async with engine.begin() as conn:
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**params, "cursor": next_at})
        async with engine.begin() as conn:
            await finance._lock(conn, run.scope)
            first_due = await materialize_run_events(conn, run)
        assert first_due and all(item.simulation_cursor_at <= next_at
                                 for item in first_due)
        async with engine.begin() as conn:
            await finance._lock(conn, run.scope)
            again = await materialize_run_events(conn, run)
            count = (await conn.execute(text("""
                SELECT count(*) FROM simulation_order_events
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
        assert again == first_due and count == len(first_due)

        async with engine.begin() as conn:
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**params, "cursor": run.scenario.simulation_end_at})
        async with engine.begin() as conn:
            await finance._lock(conn, run.scope)
            complete = await materialize_run_events(conn, run)
        assert complete[:len(first_due)] == first_due
        assert len(complete) >= len(first_due)
        assert {item.kind for item in complete} >= {"accepted", "fill"}
        assert tuple(complete) == tuple(sorted(complete,
            key=lambda item: (item.simulation_cursor_at, item.order_ordinal,
                              item.sequence, item.source_event_id)))
    finally:
        await engine.dispose()
