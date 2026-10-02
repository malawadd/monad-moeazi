"""Original close selection survives later signals in the actual restricted store."""
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_maintenance_selection import select_maintenance_command
from moeazi_agent.lifecycle_phase_receipts import PhaseCommand
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.simulation_workflow_contracts import SimulationControl
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_postgres_protection_origin import _required_entry
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
async def test_selection_preserves_noop_and_owner_command_across_later_signals():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        run, order = await _required_entry(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        await repo.fold_order_events(run.scope, run.run_id, order,
            worker_id="stage2-verifier", command_id=f"selection-source-{uuid4()}")
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        async with narrow.connect() as conn:
            owner = (await conn.execute(text("""
                SELECT created_by_subject FROM simulation_runs WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id
            """), params)).scalar_one()

        async def close(subject):
            control = SimulationControl(command_id=f"selection-close-{uuid4()}",
                operation="request_close", instrument_version_id=run.instrument_version_ids[0])
            result = await repo.apply_control(run.scope, run.run_id, run.manifest_hash,
                control, worker_id="api-fixture", command_id=control.command_id,
                requested_by_subject=subject)
            assert result["outcome"] == "applied"
            return control.command_id

        def phase(identity, inputs=None):
            return PhaseCommand(run.scope, run.run_id, run.manifest_hash, identity,
                                "maintenance_select", inputs or {})

        await close(None)  # Legacy actorless commands cannot grant maintenance authority.
        empty = phase("selection-before-owner")
        assert await select_maintenance_command(repo, empty, "stage2-verifier") == {
            "commandId": None, "skipped": True}
        first_close = await close(owner)
        # A lost no-op response must not pick up the newly arriving owner command.
        assert await select_maintenance_command(repo, empty, "stage2-verifier") == {
            "commandId": None, "skipped": True}
        selected = phase("selection-owner")
        first = await select_maintenance_command(repo, selected, "stage2-verifier")
        assert first["commandId"] == first_close and first["skipped"] is False
        await close(owner)
        assert await select_maintenance_command(repo, selected, "stage2-verifier") == first
        with pytest.raises(FinanceError, match="identity conflicts"):
            await select_maintenance_command(repo,
                phase("selection-owner", {"changed": True}), "stage2-verifier")
        async with narrow.connect() as conn:
            assert (await conn.execute(text("""
                SELECT count(*) FROM simulation_maintenance_reductions
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one() == 0
    finally:
        await narrow.dispose()
        await broad.dispose()
