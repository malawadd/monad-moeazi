"""Genuine settled origin plus fail-closed historical increase-policy adversaries."""
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_replay_admission_checks import require_replay_entry_checkpoint
from moeazi_agent.lifecycle_simulator import simulate_order
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_postgres_protection_origin import _required_entry
from test_stage3_protection_policy_wire import policy
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
async def test_bounded_increase_requires_real_settlement_before_earliest_deadline(monkeypatch):
    import test_lifecycle_preparation_postgres as fixture

    original_manifest = fixture.manifest
    historical = policy(maximum_unprotected_seconds=5,
                        allow_increases_before_deadline=True)
    monkeypatch.setattr(fixture, "manifest", lambda **values: original_manifest(
        **(values | {"protection_policy": historical})))
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        run, order_id = await _required_entry(broad, advance_to_end=False)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow),
                                             simulator=simulate_order)
        await repo.advance_replay_cursor(run.scope, run.run_id, run.manifest_hash,
            worker_id="stage2-verifier", command_id=f"source-{uuid4()}")
        await repo.fold_order_events(run.scope, run.run_id, order_id,
            worker_id="stage2-verifier", command_id=f"fold-{uuid4()}")
        await repo.reconcile_replay_checkpoint(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier",
            command_id=f"checkpoint-{uuid4()}")
        result = await repo.settle_replay_reservations(run.scope, run.run_id,
            run.manifest_hash, worker_id="stage2-verifier",
            command_id=f"settle-{uuid4()}")
        assert result["settled"]
        params = {**run.scope.model_dump(), "run_id": run.run_id,
                  "order_id": order_id}
        async with narrow.begin() as conn:
            stored = (await conn.execute(text("""
                SELECT * FROM simulation_runs WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id FOR UPDATE
            """), params)).mappings().one()
            await require_replay_entry_checkpoint(conn, run.scope, run, stored,
                run.instrument_version_ids[0], "spot_buy")
            with pytest.raises(FinanceError, match="cross-scope|protection"):
                await require_replay_entry_checkpoint(conn, run.scope, run, stored,
                    "another-instrument", "spot_buy")
            reservation_id = (await conn.execute(text("""
                SELECT reservation_id FROM simulation_orders
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id AND order_id=:order_id
            """), params)).scalar_one()
            with pytest.raises(FinanceError, match="final financial disposition"):
                async with conn.begin_nested():
                    await conn.execute(text("""
                        UPDATE finance_reservations SET resolution_proof_hash=NULL
                        WHERE environment=:environment AND scope_id=:scope_id
                          AND strategy_account_id=:strategy_account_id
                          AND reservation_id=:reservation_id
                    """), {**params, "reservation_id": reservation_id})
                    await require_replay_entry_checkpoint(conn, run.scope, run,
                        stored, run.instrument_version_ids[0], "spot_buy")
            with pytest.raises(FinanceError, match="non-intended"):
                async with conn.begin_nested():
                    await conn.execute(text("""
                        UPDATE simulation_protections SET status='requested',
                          requested_at=:cursor WHERE environment=:environment
                          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                          AND run_id=:run_id
                    """), {**params, "cursor": stored["replay_cursor_at"]})
                    await require_replay_entry_checkpoint(conn, run.scope, run,
                        stored, run.instrument_version_ids[0], "spot_buy")
        await repo.advance_replay_cursor(run.scope, run.run_id, run.manifest_hash,
            worker_id="stage2-verifier", command_id=f"deadline-{uuid4()}")
        async with narrow.begin() as conn:
            stored = (await conn.execute(text("""
                SELECT * FROM simulation_runs WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id FOR UPDATE
            """), params)).mappings().one()
            with pytest.raises(FinanceError, match="earliest deadline"):
                await require_replay_entry_checkpoint(conn, run.scope, run, stored,
                    run.instrument_version_ids[0], "spot_buy")
    finally:
        await narrow.dispose()
        await broad.dispose()
