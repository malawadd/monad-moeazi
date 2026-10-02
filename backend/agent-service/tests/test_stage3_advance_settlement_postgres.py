"""Public advance recovers a lost settlement response without changing its command."""
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.simulation_workflow_contracts import SimulationControl
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_control_processing_postgres import submitted
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
async def test_advance_recovers_committed_settlement_response(monkeypatch):
    import test_lifecycle_preparation_postgres as fixture

    original = fixture.scenario
    monkeypatch.setattr(fixture, "scenario", lambda **values: original(
        **(values | {"depth_participation_bps": 50})))
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, run, order = await submitted(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        control = SimulationControl(command_id="advance-cancel", operation="request_cancel",
                                    order_id=order)
        await repo.apply_control(run.scope, run.run_id, run.manifest_hash, control,
            worker_id="api-fixture", command_id=control.command_id)
        original_settle = repo.settle_replay_reservations
        lost = False

        async def lose_once(*args, **kwargs):
            nonlocal lost
            result = await original_settle(*args, **kwargs)
            if result["settled"] and not lost:
                lost = True
                raise ConnectionError("lost committed settlement response")
            return result

        monkeypatch.setattr(repo, "settle_replay_reservations", lose_once)
        command = None
        for step in range(20):
            command = f"advance-through-settlement-{step}"
            try:
                await repo.advance_run(run.scope, run.run_id, run.manifest_hash,
                    "stage2-verifier", command)
            except ConnectionError as error:
                assert str(error) == "lost committed settlement response"
                break
        assert lost, "bounded public advance never reached settlement"
        params = {**run.scope.model_dump(), "run_id": run.run_id}

        async def read_proof():
            async with narrow.connect() as conn:
                return (await conn.execute(text("""
                    SELECT z.resolution_hash,z.account_revision_after,z.command_id,
                      z.cumulative_filled_units,r.status,a.revision
                    FROM simulation_reservation_resolutions z
                    JOIN finance_reservations r USING
                      (environment,scope_id,strategy_account_id,reservation_id)
                    JOIN finance_accounts a USING(environment,scope_id,strategy_account_id)
                    WHERE z.environment=:environment AND z.scope_id=:scope_id
                      AND z.strategy_account_id=:strategy_account_id AND z.run_id=:run_id
                """), params)).mappings().one()

        before = await read_proof()
        assert before["status"] == "settled"
        assert int(before["cumulative_filled_units"]) == 500_000
        assert before["command_id"] == f"{command}:settlement"
        recovered = await repo.advance_run(run.scope, run.run_id, run.manifest_hash,
            "stage2-verifier", command)
        assert recovered.next_action == "advance"
        assert await repo.advance_run(run.scope, run.run_id, run.manifest_hash,
            "stage2-verifier", command) == recovered
        assert dict(await read_proof()) == dict(before)
    finally:
        await narrow.dispose()
        await broad.dispose()
