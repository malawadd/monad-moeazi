"""Actual disposable Q4 proof-backed partial cancellation settlement."""
from datetime import timedelta
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
import pytest

from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_cancel_receipts import load_cancel_dispatches
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_reservation_settlement import funding_pending
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.simulation_workflow_contracts import SimulationControl
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_control_processing_postgres import submitted, process
from test_stage3_simulation_database_role import qualification


def test_frozen_funding_fact_keeps_order_hold_until_its_cursor():
    from test_stage3_run_funding_exposure import funding, run_for
    from test_stage3_perp_simulator_oracle import perp_book, perp_definition
    from test_stage3_simulator_oracle import scenario_for
    from test_stage2_observation_replay import NOW

    definition = perp_definition()
    rows = (perp_book(25_000, "buy", "retained-funding"),)
    scenario = scenario_for(rows, fee_rules=(), outcome_rules=(),
        funding_rules=(funding(1, definition),))
    run = run_for(definition, rows, scenario)
    due = scenario.funding_rules[0].at_cursor
    assert funding_pending(run, 1, NOW)
    assert funding_pending(run, 1, due - timedelta(microseconds=1))
    assert not funding_pending(run, 1, due)
    assert not funding_pending(run, 2, NOW)


@pytest.mark.asyncio
async def test_partial_cancel_settles_only_after_exact_derived_checkpoint(monkeypatch):
    import test_lifecycle_preparation_postgres as fixture
    original = fixture.scenario
    monkeypatch.setattr(fixture, "scenario", lambda **values: original(
        **(values | {"depth_participation_bps": 50})))
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, order = await submitted(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow),
                                             simulator=simulate_order)
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        command = SimulationControl(command_id="settle-cancel", operation="request_cancel",
                                    order_id=order)
        await repo.apply_control(run.scope, run.run_id, run.manifest_hash, command,
            worker_id="api-fixture", command_id=command.command_id)
        assert (await process(repo, run))["dispatchedCount"] == 1
        await repo.fold_order_events(run.scope, run.run_id, order,
            worker_id="stage2-verifier", command_id="settle-fold-early")
        async with narrow.connect() as conn:
            dispatch, = await load_cancel_dispatches(conn, run)
        async with broad.begin() as conn:
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**params, "cursor": dispatch.effectiveCursor})
        await repo.fold_order_events(run.scope, run.run_id, order,
            worker_id="stage2-verifier", command_id="settle-fold-terminal")
        with pytest.raises(Exception, match="checkpoint"):
            await repo.settle_replay_reservations(run.scope, run.run_id,
                run.manifest_hash, worker_id="stage2-verifier",
                command_id="settle-too-early")
        checkpoint = await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier",
            command_id="settle-checkpoint")
        assert checkpoint["snapshotHash"] != run.account_snapshot_hash
        first = await repo.settle_replay_reservations(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id="settle-final")
        assert first["settled"] is True and first["status"] == "clean"
        retry = await repo.settle_replay_reservations(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id="settle-final")
        assert retry == first
        async with narrow.connect() as conn:
            row = (await conn.execute(text("""
                SELECT r.status,r.resolution_proof_hash,z.resolution_hash,
                  z.cumulative_filled_units,a.reconciliation_state,a.revision
                FROM simulation_orders o JOIN finance_reservations r USING
                  (environment,scope_id,strategy_account_id,reservation_id)
                JOIN simulation_reservation_resolutions z USING
                  (environment,scope_id,strategy_account_id,reservation_id)
                JOIN finance_accounts a USING
                  (environment,scope_id,strategy_account_id)
                WHERE o.environment=:environment AND o.scope_id=:scope_id
                  AND o.strategy_account_id=:strategy_account_id AND o.run_id=:run_id
            """), params)).mappings().one()
        assert row["status"] == "settled"
        assert row["resolution_proof_hash"] == row["resolution_hash"]
        assert int(row["cumulative_filled_units"]) == 500_000
        assert row["reconciliation_state"] == "clean"
        assert row["revision"] == first["accountRevision"]
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_zero_fill_rejection_releases_without_forged_derived_snapshot(monkeypatch):
    import test_lifecycle_preparation_postgres as fixture
    original = fixture.scenario

    def rejected(**values):
        cursor = values["simulation_cursor_at"]
        return original(**(values | {"outcome_rules": ({"order_ordinal": 1,
            "source_event_id": "zero-fill-reject", "kind": "rejected",
            "at_cursor": cursor + timedelta(seconds=1)},)}))

    monkeypatch.setattr(fixture, "scenario", rejected)
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, order = await submitted(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow),
                                             simulator=simulate_order)
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        async with broad.begin() as conn:
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**params, "cursor": run.scenario.simulation_end_at})
        await repo.fold_order_events(run.scope, run.run_id, order,
            worker_id="stage2-verifier", command_id="reject-fold")
        released = await repo.settle_replay_reservations(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id="reject-resolve")
        assert released["settled"] is True and released["status"] == "clean"
        async with narrow.connect() as conn:
            row = (await conn.execute(text("""
                SELECT r.status,z.disposition,z.cumulative_filled_units,
                  z.account_snapshot_hash,
                  (SELECT count(*) FROM simulation_derived_snapshots d
                   WHERE d.environment=z.environment AND d.scope_id=z.scope_id
                     AND d.strategy_account_id=z.strategy_account_id
                     AND d.run_id=z.run_id) derived_count
                FROM simulation_reservation_resolutions z
                JOIN finance_reservations r USING
                  (environment,scope_id,strategy_account_id,reservation_id)
                WHERE z.environment=:environment AND z.scope_id=:scope_id
                  AND z.strategy_account_id=:strategy_account_id AND z.run_id=:run_id
            """), params)).mappings().one()
        assert row["status"] == row["disposition"] == "released"
        assert int(row["cumulative_filled_units"]) == 0
        assert row["account_snapshot_hash"] == run.account_snapshot_hash
        assert row["derived_count"] == 0
        assert await repo.settle_replay_reservations(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier",
            command_id="reject-resolve") == released
    finally:
        await narrow.dispose()
        await broad.dispose()
