"""SQL065 fail-in-middle: source, journal, position and fold receipt commit together."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent import lifecycle_event_fold
from test_lifecycle_preparation_postgres import guarded_dsn, setup


async def started(engine):
    repo, finance, run, intent, reserved = await setup(engine)
    await repo.persist_intent(intent)
    prepared = await repo.prepare_order(intent, reserved["reservationId"], 1,
        worker_id="stage2-verifier", command_id="fold-prepare")
    approval = await repo.record_simulation_approval(run.scope, run.run_id,
        run.manifest_hash, intent.intent_id, prepared["normalizedPayloadHash"],
        "verified-owner", datetime.now(timezone.utc) + timedelta(seconds=45),
        "fold-approve")
    await repo.start_order(run.scope, run.run_id, prepared["orderId"],
        worker_id="stage2-verifier",
        approval_receipt_hash=approval["approvalReceiptHash"])
    async with engine.begin() as conn:
        await conn.execute(text("""
            UPDATE simulation_runs SET replay_cursor_at=:cursor
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id AND run_id=:run_id
        """), {**run.scope.model_dump(), "run_id": run.run_id,
            "cursor": run.scenario.simulation_end_at})
    return repo, run, prepared, reserved


async def state(engine, run, order_id):
    params = {**run.scope.model_dump(), "run_id": run.run_id,
              "order_id": order_id, "source_owner": f"simulation:{run.run_id}"}
    async with engine.connect() as conn:
        counts = {}
        for key, table, condition in (
            ("events", "simulation_order_events", "run_id=:run_id"),
            ("folds", "simulation_event_folds", "run_id=:run_id"),
            ("links", "simulation_event_journal_links", "run_id=:run_id"),
            ("positions", "simulation_positions", "run_id=:run_id"),
        ):
            counts[key] = (await conn.execute(text(f"""
                SELECT count(*) FROM {table} WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND {condition}
            """), params)).scalar_one()
        counts["journals"] = (await conn.execute(text("""
            SELECT count(*) FROM finance_journal_transactions j
            JOIN finance_source_events s USING(environment,scope_id,
                strategy_account_id,source_event_hash)
            WHERE j.environment=:environment AND j.scope_id=:scope_id
              AND j.strategy_account_id=:strategy_account_id
              AND s.source_owner=:source_owner
        """), params)).scalar_one()
        order = (await conn.execute(text("""
            SELECT status,cumulative_filled_units,reservation_id
            FROM simulation_orders WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
              AND run_id=:run_id AND order_id=:order_id
        """), params)).mappings().one()
        account_revision = (await conn.execute(text("""
            SELECT revision FROM finance_accounts WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
        """), params)).scalar_one()
    return counts, dict(order), account_revision


@pytest.mark.asyncio
async def test_failure_after_journal_write_rolls_back_all_then_retry_commits_once(monkeypatch):
    engine = create_async_engine(guarded_dsn())
    try:
        repo, run, prepared, reserved = await started(engine)
        before = await state(engine, run, prepared["orderId"])
        assert before[0] == dict(events=0, folds=0, links=0, positions=0,
                                 journals=0)
        assert before[1]["status"] == "submission_possible"
        original = lifecycle_event_fold.write_position_effect

        async def crash_after_journal(*_args, **_kwargs):
            raise RuntimeError("injected crash after journal write")

        monkeypatch.setattr(lifecycle_event_fold, "write_position_effect",
                            crash_after_journal)
        with pytest.raises(RuntimeError, match="injected crash"):
            await repo.fold_order_events(run.scope, run.run_id,
                prepared["orderId"], worker_id="stage2-verifier",
                command_id="fold-after-journal-crash")
        assert await state(engine, run, prepared["orderId"]) == before

        monkeypatch.setattr(lifecycle_event_fold, "write_position_effect", original)
        committed = await repo.fold_order_events(run.scope, run.run_id,
            prepared["orderId"], worker_id="stage2-verifier",
            command_id="fold-after-journal-crash")
        after = await state(engine, run, prepared["orderId"])
        assert committed["foldedCount"] >= 2
        assert after[0]["events"] == committed["foldedCount"]
        assert after[0]["folds"] == committed["foldedCount"]
        assert after[0]["journals"] == after[0]["links"] == 1
        assert after[0]["positions"] == 1
        assert after[1]["status"] == "filled"
        assert int(after[1]["cumulative_filled_units"]) == 1_000_000
        assert after[1]["reservation_id"] == reserved["reservationId"]
        assert after[2] == before[2] + 1
        duplicate = await repo.fold_order_events(run.scope, run.run_id,
            prepared["orderId"], worker_id="stage2-verifier",
            command_id="fold-after-journal-crash")
        assert duplicate["foldedCount"] == 0
        assert await state(engine, run, prepared["orderId"]) == after
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_partial_fill_keeps_full_submitted_hold_and_blocks_new_risk(monkeypatch):
    import test_lifecycle_preparation_postgres as fixture

    original_scenario = fixture.scenario
    monkeypatch.setattr(fixture, "scenario", lambda **values: original_scenario(
        **(values | {"depth_participation_bps": 50})))
    engine = create_async_engine(guarded_dsn())
    try:
        repo, run, prepared, reserved = await started(engine)
        params = {**run.scope.model_dump(), "reservation": reserved["reservationId"]}
        async with engine.connect() as conn:
            original_hold = (await conn.execute(text("""
                SELECT capacity_key,asset_unit_id,location_id,units
                FROM finance_reservation_components
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
                  AND reservation_id=:reservation ORDER BY ordinal
            """), params)).all()
        assert original_hold
        result = await repo.fold_order_events(run.scope, run.run_id,
            prepared["orderId"], worker_id="stage2-verifier",
            command_id="fold-partial")
        assert result["foldedCount"] >= 2
        _, order, _ = await state(engine, run, prepared["orderId"])
        assert order["status"] == "partially_filled"
        assert 0 < int(order["cumulative_filled_units"]) < 1_000_000
        async with engine.connect() as conn:
            remaining_hold = (await conn.execute(text("""
                SELECT capacity_key,asset_unit_id,location_id,units
                FROM finance_reservation_components
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
                  AND reservation_id=:reservation ORDER BY ordinal
            """), params)).all()
            status = (await conn.execute(text("""
                SELECT status FROM finance_reservations
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
                  AND reservation_id=:reservation
            """), params)).scalar_one()
            reconciliation = (await conn.execute(text("""
                SELECT reconciliation_state FROM finance_accounts
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), params)).scalar_one()
        assert remaining_hold == original_hold
        assert status == "submitted"
        assert reconciliation == "unknown"
    finally:
        await engine.dispose()
