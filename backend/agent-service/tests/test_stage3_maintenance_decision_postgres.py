"""Close evidence registers locally without invoking research or provider work."""
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.lifecycle_maintenance_decision import ensure_maintenance_decision
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.observation_contracts import EvidenceSnapshot, canonical_hash
from moeazi_agent.observation_storage import ObservationRepository
from test_lifecycle_preparation_postgres import guarded_dsn, setup
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
async def test_close_decision_registers_current_evidence_and_abstains_when_stale():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, _, manifest, _, _ = await setup(broad)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        scope = manifest.scope
        params = {**scope.model_dump(), "run_id": manifest.run_id}
        async with narrow.begin() as conn:
            account = await repo.finance._lock(conn, scope)
            run = await repo._run(conn, scope, manifest.run_id, lock=True)
            before_holds = (await conn.execute(text("""
                SELECT count(*) FROM finance_reservations WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), params)).scalar_one()
            decision = await ensure_maintenance_decision(conn, scope, run, account,
                manifest.instrument_version_ids[0])
            assert decision is not None
            assert decision.cursor_at == run["replay_cursor_at"]
            assert decision.account_snapshot_hash == account["observation_snapshot_hash"]
            assert await ensure_maintenance_decision(conn, scope, run, account,
                manifest.instrument_version_ids[0]) == decision
            assert (await conn.execute(text("""
                SELECT count(*) FROM simulation_decision_contexts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id
            """), params)).scalar_one() == 1
            assert (await conn.execute(text("""
                SELECT count(*) FROM finance_reservations WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), params)).scalar_one() == before_holds
            # Harness-only time movement tests abstention, not a full replay journey.
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id
            """), {**params, "cursor": manifest.scenario.simulation_end_at})
            run = await repo._run(conn, scope, manifest.run_id, lock=True)
            assert await ensure_maintenance_decision(conn, scope, run, account,
                manifest.instrument_version_ids[0]) is None
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_close_decision_rejects_equally_recent_snapshot_ambiguity():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, _, manifest, _, _ = await setup(broad)
        async with broad.connect() as conn:
            row = (await conn.execute(text("""
                SELECT cutoff_at,instrument_version_ids,accepted_observation_hashes,
                  excluded,source_rights_refs,has_gap,snapshot_hash
                FROM observation_evidence_snapshots WHERE snapshot_hash=:hash
            """), {"hash": manifest.evidence_snapshot_hash})).mappings().one()
        original = EvidenceSnapshot.model_validate(dict(row))
        body = original.model_dump(mode="json", exclude={"snapshot_hash"})
        body["excluded"] = [{"source_id": "synthetic-qualification-exclusion",
            "source_event_id": "excluded-audit-record", "reason": "outside_dataset",
            "raw_payload_hash": "d" * 64}]
        alternate = EvidenceSnapshot.model_validate({**body, "snapshot_hash": canonical_hash(body)})
        await ObservationRepository(broad).store_evidence_snapshot(alternate)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)
        async with narrow.begin() as conn:
            account = await repo.finance._lock(conn, manifest.scope)
            run = await repo._run(conn, manifest.scope, manifest.run_id, lock=True)
            with pytest.raises(FinanceError, match="ambiguous equally recent"):
                await ensure_maintenance_decision(conn, manifest.scope, run, account,
                    manifest.instrument_version_ids[0])
            assert (await conn.execute(text("""
                SELECT count(*) FROM simulation_decision_contexts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id
            """), {**manifest.scope.model_dump(), "run_id": manifest.run_id})).scalar_one() == 0
    finally:
        await narrow.dispose()
        await broad.dispose()
