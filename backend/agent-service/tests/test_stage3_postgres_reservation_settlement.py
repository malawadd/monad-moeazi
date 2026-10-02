"""Independent Q4 terminal-hold settlement against root's disposable SQL072 DB."""
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_cancel_receipts import load_cancel_dispatches
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.simulation_workflow_contracts import SimulationControl
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_control_processing_postgres import process, submitted
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
async def test_partial_cancel_settlement_rolls_back_and_exact_retry_is_immutable(monkeypatch):
    import moeazi_agent.lifecycle_reservation_settlement as settlement
    import test_lifecycle_preparation_postgres as fixture

    original_scenario = fixture.scenario
    monkeypatch.setattr(fixture, "scenario", lambda **values: original_scenario(
        **(values | {"depth_participation_bps": 50})))
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, order_id = await submitted(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow),
                                             simulator=simulate_order)
        command = SimulationControl(command_id=f"settle-cancel-{uuid4()}",
            operation="request_cancel", order_id=order_id)
        await repo.apply_control(run.scope, run.run_id, run.manifest_hash,
            command, worker_id="api-fixture", command_id=command.command_id)
        assert (await process(repo, run))["dispatchedCount"] == 1
        early = await repo.fold_order_events(run.scope, run.run_id, order_id,
            worker_id="stage2-verifier", command_id=f"early-{uuid4()}")
        assert early["foldedCount"] == 1
        async with narrow.connect() as conn:
            dispatch, = await load_cancel_dispatches(conn, run)
        params = {**run.scope.model_dump(), "run_id": run.run_id,
                  "order_id": order_id}
        async with broad.begin() as conn:
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**params, "cursor": dispatch.effectiveCursor})
        folded = await repo.fold_order_events(run.scope, run.run_id, order_id,
            worker_id="stage2-verifier", command_id=f"terminal-{uuid4()}")
        assert folded["foldedCount"] == 3
        checkpoint = await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier",
            command_id=f"settle-checkpoint-{uuid4()}")
        assert checkpoint["status"] in {"clean", "quarantined"}

        async def state():
            async with narrow.connect() as conn:
                row = (await conn.execute(text("""
                    SELECT o.status AS order_status,o.cumulative_filled_units,
                      r.status AS hold_status,r.resolution_proof_hash,
                      a.revision,a.reconciliation_state
                    FROM simulation_orders o JOIN finance_reservations r
                      USING(environment,scope_id,strategy_account_id,reservation_id)
                    JOIN finance_accounts a USING(environment,scope_id,strategy_account_id)
                    WHERE o.environment=:environment AND o.scope_id=:scope_id
                      AND o.strategy_account_id=:strategy_account_id
                      AND o.run_id=:run_id AND o.order_id=:order_id
                """), params)).mappings().one()
                count = (await conn.execute(text("""
                    SELECT count(*) FROM simulation_reservation_resolutions
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                """), params)).scalar_one()
                return row, count

        before, count = await state()
        assert before["order_status"] == "cancelled"
        assert int(before["cumulative_filled_units"]) == 500_000
        assert before["hold_status"] == "submitted" and count == 0
        original_excess = settlement.held_excess

        async def crash_after_hold(*_args):
            raise FinanceError("injected after terminal hold update")

        monkeypatch.setattr(settlement, "held_excess", crash_after_hold)
        retry_key = f"settle-{uuid4()}"
        with pytest.raises(FinanceError, match="injected after terminal hold update"):
            await repo.settle_replay_reservations(run.scope, run.run_id,
                run.manifest_hash, worker_id="stage2-verifier",
                command_id=retry_key)
        after_failure, count = await state()
        assert dict(after_failure) == dict(before) and count == 0
        monkeypatch.setattr(settlement, "held_excess", original_excess)
        committed = await repo.settle_replay_reservations(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id=retry_key)
        duplicate = await repo.settle_replay_reservations(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier", command_id=retry_key)
        assert duplicate == committed and committed["settled"] is True
        after, count = await state()
        assert count == 1 and after["hold_status"] == "settled"
        assert after["reconciliation_state"] == "clean"
        assert after["resolution_proof_hash"] == committed["resolutionHash"]
        assert after["revision"] == before["revision"] + 1
        async with narrow.connect() as conn:
            proof = (await conn.execute(text("""
                SELECT z.cumulative_filled_units,z.disposition,z.resolution_hash,
                  z.source_root,z.journal_root,z.position_root,z.account_snapshot_hash,
                  e.kind AS terminal_kind,d.source_root AS derived_source,
                  d.journal_root AS derived_journal,d.position_root AS derived_position
                FROM simulation_reservation_resolutions z
                JOIN simulation_order_events e ON e.environment=z.environment
                  AND e.scope_id=z.scope_id AND e.strategy_account_id=z.strategy_account_id
                  AND e.run_id=z.run_id AND e.event_hash=z.terminal_event_hash
                JOIN simulation_derived_snapshots d ON d.environment=z.environment
                  AND d.scope_id=z.scope_id AND d.strategy_account_id=z.strategy_account_id
                  AND d.run_id=z.run_id AND d.snapshot_hash=z.account_snapshot_hash
                WHERE z.environment=:environment AND z.scope_id=:scope_id
                  AND z.strategy_account_id=:strategy_account_id AND z.run_id=:run_id
            """), params)).mappings().one()
        assert int(proof["cumulative_filled_units"]) == 500_000
        assert proof["disposition"] == "settled" and proof["terminal_kind"] == "cancelled"
        assert proof["resolution_hash"] == committed["resolutionHash"]
        assert (proof["source_root"], proof["journal_root"], proof["position_root"]) == \
            (proof["derived_source"], proof["derived_journal"], proof["derived_position"])
    finally:
        await narrow.dispose()
        await broad.dispose()
