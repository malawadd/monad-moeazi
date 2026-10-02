"""Actual SQL + Temporal empty-run integration, NOT a fill/protection Q4 pass."""
import asyncio
import os
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from temporalio.client import Client
from temporalio.worker import Worker

from moeazi_agent.controller_contracts import ControllerRef
from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.simulation_activities import SimulationActivities
from moeazi_agent.simulation_workflow import SimulationSupervisorWorkflow
from moeazi_agent.simulation_workflow_contracts import SimulationControl
from test_stage2_finance_postgres_sizing import setup_spot_account
from test_stage3_run_contracts import manifest, scenario


def guarded_dsn():
    raw = os.getenv("MOEAZI_Q4_POSTGRES_DSN")
    if not raw:
        pytest.skip("explicit disposable Q4 database opt-in required")
    url = make_url(raw)
    if (url.drivername, url.host, url.port, url.database) != (
        "postgresql+asyncpg", "127.0.0.1", 15432, "moeazi_q4_20260930"):
        raise RuntimeError("Only root's disposable loopback Q4 database is permitted")
    return raw


async def setup(engine):
    values = await setup_spot_account(engine, uuid4().hex)
    finance, scope, _, instrument, snapshot, evidence, policy, opened = values
    controller = ControllerRef(schemaVersion=1, environment="experiment",
        strategyAccountId=scope.strategy_account_id, controllerKind="customer_team",
        controllerId=scope.scope_id, controllerVersionId="kernel-version", contentHash="a" * 64)
    # Even an empty replay must begin after its real admitted opening observation.
    # The old fixed fixture date predates newly constructed SQL account snapshots.
    cursor = max(snapshot.cutoff_at, evidence.cutoff_at) + timedelta(milliseconds=1)
    run = manifest(scope=scope, controller_ref=controller, policy_version=policy.policy_version,
        policy_hash=policy.policy_hash, account_snapshot_hash=snapshot.snapshot_hash,
        evidence_snapshot_hash=evidence.snapshot_hash,
        instrument_version_ids=(instrument.instrument_version_id,),
        scenario=scenario(simulation_cursor_at=cursor,
            simulation_end_at=cursor + timedelta(minutes=2),
            evidence_cutoff_at=evidence.cutoff_at,
            fee_rules=(), funding_rules=(), outcome_rules=()))
    repository = SimulationLifecycleRepository(finance, simulator=simulate_order)
    state = await repository.register_run(run, created_by_subject="kernel-owner",
        experiment_request_hash="b" * 64, authority_fingerprint="c" * 64,
        expected_revision=opened["revision"], idempotency_key="empty-run-register-01")
    return finance, repository, run, state


async def financial_counts(engine, scope):
    async with engine.connect() as conn:
        row = (await conn.execute(text("""
            SELECT revision,writer_epoch,authority_epoch FROM finance_accounts
            WHERE environment=:environment AND scope_id=:scope_id
              AND strategy_account_id=:strategy_account_id
        """), scope.model_dump())).mappings().one()
        journal = (await conn.execute(text("""
            SELECT count(*) FROM finance_journal_transactions WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
        """), scope.model_dump())).scalar_one()
        return dict(row), journal


@pytest.mark.asyncio
async def test_real_sql_registration_and_stop_do_not_need_or_mutate_financial_lease():
    engine = create_async_engine(guarded_dsn())
    try:
        finance, repo, run, initial = await setup(engine)
        before, journals = await financial_counts(engine, run.scope)
        control = SimulationControl(command_id="stop-1", operation="stop_entries")
        receipt = await repo.apply_control(run.scope, run.run_id, run.manifest_hash, control,
                                          worker_id="different-api-worker", command_id="stop-1")
        duplicate = await repo.apply_control(run.scope, run.run_id, run.manifest_hash, control,
                                            worker_id="replacement-api", command_id="stop-1")
        after, later_journals = await financial_counts(engine, run.scope)
        assert receipt == duplicate and receipt["outcome"] == "applied"
        assert initial.status == "registered"
        assert after == before and journals == later_journals
        assert (await repo.read_run(run.scope, run.run_id, run.manifest_hash)).projection_revision == 1
        lineage = await repo.read_run_lineage(run.scope, run.run_id, run.manifest_hash, "kernel-owner")
        assert lineage["datasetHash"] == run.scenario.dataset_hash
        assert lineage["manifestHash"] == run.manifest_hash
        with pytest.raises(FinanceError):
            await repo.read_run_lineage(run.scope, run.run_id, run.manifest_hash, "other-owner")
        async with engine.connect() as conn:
            stopped = (await conn.execute(text("""
                SELECT entries_stopped FROM simulation_runs WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
                  AND run_id=:run_id
            """), {**run.scope.model_dump(), "run_id": run.run_id})).scalar_one()
        assert stopped is True
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_real_sql_temporal_register_wait_stop_wake_complete_empty_account():
    address = os.getenv("MOEAZI_Q4_TEMPORAL_ADDRESS")
    if not address:
        pytest.skip("explicit local Temporal opt-in required")
    if address != "127.0.0.1:7233":
        raise RuntimeError("Only existing local Temporal is permitted")
    engine = create_async_engine(guarded_dsn())
    handle = None
    try:
        finance, repo, run, _ = await setup(engine)
        # The setup fixture owns this lease; shorten it via its actual owner API.
        await finance.acquire_writer_epoch(run.scope, "stage2-verifier", lease_seconds=1)
        await asyncio.sleep(1.1)
        client = await Client.connect(address, namespace="default")
        queue = f"q4-empty-sql-{uuid4()}"
        activities = SimulationActivities(repo, f"q4-physical-{uuid4()}")
        async with Worker(client, task_queue=queue, workflows=[SimulationSupervisorWorkflow],
                          activities=[activities.advance, activities.control]):
            handle = await client.start_workflow(SimulationSupervisorWorkflow.run,
                {"scope": run.scope.model_dump(), "run_id": run.run_id,
                 "manifest_hash": run.manifest_hash}, id=queue, task_queue=queue)
            async with asyncio.timeout(15):
                while (await handle.query("state"))["status"] != "registered":
                    await asyncio.sleep(0.05)
            await repo.apply_control(run.scope, run.run_id, run.manifest_hash,
                SimulationControl(command_id="api-stop-1", operation="stop_entries"),
                worker_id="independent-api-worker", command_id="api-stop-1")
            await handle.signal("wake")
            result = await asyncio.wait_for(handle.result(), timeout=15)
            assert result["status"] == "completed_flat"
            persisted = await repo.read_run(run.scope, run.run_id, run.manifest_hash)
            assert persisted.status == "completed_flat" and not persisted.pending_obligations
    finally:
        if handle:
            await handle.cancel()
        await engine.dispose()
