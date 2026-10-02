"""Actual SQL065 replay decisions bind the current scoped checkpoint and cursor."""
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.observation_contracts import InstrumentVersion, canonical_hash
from moeazi_agent.observation_replay import replay_observations
from moeazi_agent.observation_storage import ObservationRepository
from test_stage2_finance_postgres_sizing import setup_spot_account
from test_stage3_postgres_dataset import guarded_dsn, setup


async def registered(engine):
    repo, run, rows = await setup(engine)
    await repo.register_run_dataset(run.scope, run.run_id, run.manifest_hash,
        tuple(canonical_hash(row.model_dump(mode="json")) for row in rows),
        "dataset-owner")
    async with engine.connect() as conn:
        body = (await conn.execute(text("""
            SELECT manifest FROM observation_instrument_versions
            WHERE instrument_version_id=:instrument
        """), {"instrument": run.instrument_version_ids[0]})).scalar_one()
    return repo, run, rows, InstrumentVersion.model_validate(body)


@pytest.mark.asyncio
async def test_decision_retry_future_evidence_and_later_cursor_identity():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, run, rows, instrument = await registered(engine)
        first = await repo.register_replay_decision(run.scope, run.run_id,
            run.manifest_hash, instrument.instrument_version_id,
            run.evidence_snapshot_hash)
        assert first.dataset_prefix_count == 1
        assert first.cursor_at == run.scenario.simulation_cursor_at
        assert (await repo.register_replay_decision(run.scope, run.run_id,
            run.manifest_hash, instrument.instrument_version_id,
            run.evidence_snapshot_hash)) == first
        later_cursor = run.scenario.simulation_cursor_at + timedelta(seconds=1)
        later = replay_observations((instrument,), rows, later_cursor, 60_000)
        assert len(later.accepted_observation_hashes) == 2 and not later.has_gap
        await ObservationRepository(engine).store_evidence_snapshot(later)
        with pytest.raises(FinanceError, match="corpus or cursor"):
            await repo.register_replay_decision(run.scope, run.run_id,
                run.manifest_hash, instrument.instrument_version_id,
                later.snapshot_hash)
        async with engine.begin() as conn:
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**run.scope.model_dump(), "run_id": run.run_id,
                "cursor": later_cursor})
        second = await repo.register_replay_decision(run.scope, run.run_id,
            run.manifest_hash, instrument.instrument_version_id,
            later.snapshot_hash)
        assert second.dataset_prefix_count == 2
        assert second.cursor_at == later_cursor
        assert second.decision_hash != first.decision_hash
        assert second.evidence_snapshot_hash == later.snapshot_hash
        assert (await repo.register_replay_decision(run.scope, run.run_id,
            run.manifest_hash, instrument.instrument_version_id,
            later.snapshot_hash)) == second
        async with engine.begin() as conn:
            await conn.execute(text("""
                UPDATE finance_accounts SET reconciliation_state='unknown'
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), run.scope.model_dump())
        with pytest.raises(FinanceError, match="clean current financial"):
            await repo.register_replay_decision(run.scope, run.run_id,
                run.manifest_hash, instrument.instrument_version_id,
                later.snapshot_hash)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_foreign_account_observation_cannot_be_used_for_decision():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, run, _, instrument = await registered(engine)
        _, _, _, _, foreign, _, _, _ = await setup_spot_account(
            engine, f"foreign-{uuid4().hex}")
        async with engine.begin() as conn:
            await conn.execute(text("""
                UPDATE finance_accounts SET observation_snapshot_hash=:foreign
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), {**run.scope.model_dump(), "foreign": foreign.snapshot_hash})
        with pytest.raises(FinanceError, match="account observation is unavailable"):
            await repo.register_replay_decision(run.scope, run.run_id,
                run.manifest_hash, instrument.instrument_version_id,
                run.evidence_snapshot_hash)
    finally:
        await engine.dispose()
