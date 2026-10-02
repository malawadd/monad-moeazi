"""Connected SQL path with the actual restricted worker login; no provider calls."""
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.lifecycle_strategy import ReplayStrategyRule
from moeazi_agent.observation_contracts import canonical_hash
from moeazi_agent.simulation_database_guard import verify_simulation_database_role
from moeazi_agent.simulation_workflow_contracts import SimulationControl
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_lifecycle_contracts import H, seal
from test_stage3_postgres_dataset import setup
from test_stage3_run_contracts import manifest
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["shadow", "approval_required", "autopilot"])
async def test_restricted_register_dataset_decision_queue_is_non_authorizing(mode):
    # Only the fixture setup may admit synthetic observations through the admin
    # connection. Every run/data/decision/queue/control command below uses the
    # same restricted role used by the real worker process.
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        _, baseline, rows = await setup(broad)
        await verify_simulation_database_role(narrow)
        rule = seal(ReplayStrategyRule, "moeazi-replay-strategy-rule-v1", "rule_hash",
            dict(schema_version=1, instrument_version_id=baseline.instrument_version_ids[0],
                action="spot_buy", side="buy", trigger="always",
                threshold_price_quote_per_base=None, desired_quantity_units="1000000",
                horizon_seconds=60, rationale_summary="Restricted replay qualification"))
        run = manifest(**{**baseline.model_dump(mode="python", exclude={"manifest_hash"}),
            "run_id": f"restricted-{uuid4().hex}", "controller_mode": mode,
            "scope": baseline.scope, "controller_ref": baseline.controller_ref,
            "scenario": baseline.scenario,
            "strategy_artifact_hash": rule.rule_hash})
        finance = FinanceRepository(narrow)
        repo = SimulationLifecycleRepository(finance, simulator=simulate_order)
        async with narrow.connect() as conn:
            revision = (await conn.execute(text("""
                SELECT revision FROM finance_accounts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), run.scope.model_dump())).scalar_one()
        options = dict(created_by_subject="dataset-owner", experiment_request_hash=H,
            authority_fingerprint=H, expected_revision=revision,
            idempotency_key=f"register-{run.run_id}")
        registered = await repo.register_run(run, **options)
        assert registered.status == "registered"
        assert await repo.register_run(run, **options) == registered
        hashes = tuple(canonical_hash(row.model_dump(mode="json")) for row in rows)
        attached = await repo.register_run_dataset(run.scope, run.run_id,
            run.manifest_hash, hashes, "dataset-owner")
        assert attached["observationCount"] == 2
        decision = await repo.register_replay_decision(run.scope, run.run_id,
            run.manifest_hash, run.instrument_version_ids[0], run.evidence_snapshot_hash)
        assert decision.account_snapshot_hash == run.account_snapshot_hash
        assert decision.dataset_prefix_count == 1
        assert decision.cursor_at == run.scenario.simulation_cursor_at
        assert decision == await repo.register_replay_decision(run.scope, run.run_id,
            run.manifest_hash, run.instrument_version_ids[0], run.evidence_snapshot_hash)
        queued = await repo.queue_entry_request(run.scope, run.run_id,
            run.manifest_hash, rule, "dataset-owner", "request-1")
        assert queued["status"] == "queued"
        assert queued == await repo.queue_entry_request(run.scope, run.run_id,
            run.manifest_hash, rule, "dataset-owner", "request-1")
        with pytest.raises(FinanceError, match="owner"):
            await repo.queue_entry_request(run.scope, run.run_id,
                run.manifest_hash, rule, "foreign-owner", "request-2")
        stop = SimulationControl(command_id="stop-before-worker", operation="stop_entries")
        await repo.apply_control(run.scope, run.run_id, run.manifest_hash, stop,
            worker_id="restricted-api-fixture", command_id=stop.command_id)
        with pytest.raises(FinanceError, match="stopped"):
            await repo.queue_entry_request(run.scope, run.run_id,
                run.manifest_hash, rule, "dataset-owner", "request-after-stop")
        async with narrow.connect() as conn:
            stats = (await conn.execute(text("""
                SELECT a.revision,
                  (SELECT count(*) FROM simulation_decision_contexts d
                    WHERE d.environment=a.environment AND d.scope_id=a.scope_id
                      AND d.strategy_account_id=a.strategy_account_id AND d.run_id=:run_id) decisions,
                  (SELECT count(*) FROM simulation_entry_requests q
                    WHERE q.environment=a.environment AND q.scope_id=a.scope_id
                      AND q.strategy_account_id=a.strategy_account_id AND q.run_id=:run_id) requests,
                  (SELECT count(*) FROM simulation_orders o
                    WHERE o.environment=a.environment AND o.scope_id=a.scope_id
                      AND o.strategy_account_id=a.strategy_account_id AND o.run_id=:run_id) orders,
                  (SELECT count(*) FROM finance_reservations r
                    WHERE r.environment=a.environment AND r.scope_id=a.scope_id
                      AND r.strategy_account_id=a.strategy_account_id) reservations
                FROM finance_accounts a WHERE a.environment=:environment
                  AND a.scope_id=:scope_id AND a.strategy_account_id=:strategy_account_id
            """), {**run.scope.model_dump(), "run_id": run.run_id})).mappings().one()
        assert dict(stats) == dict(revision=revision, decisions=1, requests=1,
                                   orders=0, reservations=0)
    finally:
        await narrow.dispose()
        await broad.dispose()
