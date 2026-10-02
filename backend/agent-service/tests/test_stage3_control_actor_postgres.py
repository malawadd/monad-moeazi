"""Real command actor provenance and replay binding in the disposable Q4 database."""
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.simulation_workflow_contracts import SimulationControl
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_postgres_protection_origin import _required_entry
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
async def test_control_records_owner_and_rejects_actor_rebinding():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        run, order = await _required_entry(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        await repo.fold_order_events(run.scope, run.run_id, order,
            worker_id="stage2-verifier", command_id=f"actor-source-{uuid4()}")
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        async with narrow.connect() as conn:
            owner = (await conn.execute(text("""
                SELECT created_by_subject FROM simulation_runs WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
        command = SimulationControl(command_id=f"owner-close-{uuid4()}", operation="request_close",
                                    instrument_version_id=run.instrument_version_ids[0])
        with pytest.raises(FinanceError):
            await repo.apply_control(run.scope, run.run_id, run.manifest_hash, command,
                worker_id="api-fixture", command_id=command.command_id,
                requested_by_subject="foreign-owner")
        async with narrow.connect() as conn:
            assert (await conn.execute(text("""
                SELECT count(*) FROM simulation_commands WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one() == 0
        first = await repo.apply_control(run.scope, run.run_id, run.manifest_hash, command,
            worker_id="api-fixture", command_id=command.command_id, requested_by_subject=owner)
        assert first["outcome"] == "applied"
        assert await repo.apply_control(run.scope, run.run_id, run.manifest_hash, command,
            worker_id="api-fixture", command_id=command.command_id, requested_by_subject=owner) == first
        # Omitting the actor must not adopt a command previously authenticated by the API.
        with pytest.raises(FinanceError, match="conflicts"):
            await repo.apply_control(run.scope, run.run_id, run.manifest_hash, command,
                worker_id="api-fixture", command_id=command.command_id)
        async with narrow.connect() as conn:
            actors = (await conn.execute(text("""
                SELECT requested_by_subject FROM simulation_commands WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalars().all()
        assert actors == [owner]
    finally:
        await narrow.dispose()
        await broad.dispose()
