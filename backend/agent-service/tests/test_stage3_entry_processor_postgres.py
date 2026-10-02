"""Real restricted SQL evaluation/retry with a deliberately gated financial owner."""
import json
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_entry_processor import LifecycleEntryProcessorMixin
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from moeazi_agent.lifecycle_strategy import ReplayStrategyRule
from moeazi_agent.observation_contracts import canonical_hash
from moeazi_agent.simulation_workflow_contracts import SimulationControl
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_lifecycle_contracts import H, seal
from test_stage3_postgres_dataset import setup
from test_stage3_run_contracts import manifest
from test_stage3_simulation_database_role import qualification


async def prepare(broad, narrow, *, hold=False):
    _, base, rows = await setup(broad)
    rule = seal(ReplayStrategyRule, "moeazi-replay-strategy-rule-v1", "rule_hash",
        dict(schema_version=1, instrument_version_id=base.instrument_version_ids[0],
            action="spot_buy", side="buy", trigger="ask_lte" if hold else "always",
            threshold_price_quote_per_base="1" if hold else None,
            desired_quantity_units="1000000", horizon_seconds=60,
            rationale_summary="SQL processor qualification"))
    run = manifest(**{**base.model_dump(mode="python", exclude={"manifest_hash"}),
        "scope": base.scope, "controller_ref": base.controller_ref, "scenario": base.scenario,
        "run_id": f"processor-{uuid4().hex}", "strategy_artifact_hash": rule.rule_hash})
    async def forbidden_authorizer(_):
        raise AssertionError("Evaluation alone must not claim fresh entry authority")
    repo = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order,
                                         entry_authorizer=forbidden_authorizer)
    async with narrow.connect() as conn:
        revision = (await conn.execute(text("""
            SELECT revision FROM finance_accounts WHERE environment=:environment
              AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
        """), run.scope.model_dump())).scalar_one()
    await repo.register_run(run, created_by_subject="dataset-owner",
        experiment_request_hash=H, authority_fingerprint=H, expected_revision=revision,
        idempotency_key=f"register-{run.run_id}")
    await repo.register_run_dataset(run.scope, run.run_id, run.manifest_hash,
        tuple(canonical_hash(row.model_dump(mode="json")) for row in rows), "dataset-owner")
    for request_id in ("request-a", "request-b"):
        await repo.queue_entry_request(run.scope, run.run_id, run.manifest_hash,
                                       rule, "dataset-owner", request_id)
    calls = []
    async def unavailable_finance(scope, run_id, digest, request_id, worker_id, command_id):
        calls.append((request_id, command_id))
        return {"requestId": request_id, "status": "awaiting_finance",
                "reason": "qualification_financial_owner_unavailable"}
    repo.prepare_replay_entry = unavailable_finance
    return repo, run, calls, revision


async def process(repo, run, command):
    return await LifecycleEntryProcessorMixin.process_next_entry_request(repo,
        run.scope, run.run_id, run.manifest_hash, "stage2-verifier", command)


@pytest.mark.asyncio
async def test_hold_command_retry_cannot_advance_to_a_different_request():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        repo, run, calls, revision = await prepare(broad, narrow, hold=True)
        first = await process(repo, run, "tick-1")
        assert (first["requestId"], first["status"]) == ("request-a", "completed")
        assert await process(repo, run, "tick-1") == first
        second = await process(repo, run, "tick-2")
        assert (second["requestId"], second["status"]) == ("request-b", "completed")
        assert (await process(repo, run, "tick-idle"))["status"] == "idle"
        async with narrow.connect() as conn:
            rule_json = (await conn.execute(text("""
                SELECT rule_json FROM simulation_entry_requests
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND request_id='request-a'
            """), {**run.scope.model_dump(), "run_id": run.run_id})).scalar_one()
        rule = ReplayStrategyRule.model_validate_json(json.dumps(rule_json))
        await repo.queue_entry_request(run.scope, run.run_id, run.manifest_hash,
                                       rule, "dataset-owner", "request-c")
        assert (await process(repo, run, "tick-idle"))["status"] == "idle"
        assert (await process(repo, run, "tick-3"))["requestId"] == "request-c"
        assert calls == []
        async with narrow.connect() as conn:
            row = (await conn.execute(text("""
                SELECT revision,(SELECT count(*) FROM finance_reservations r
                  WHERE r.environment=a.environment AND r.scope_id=a.scope_id
                    AND r.strategy_account_id=a.strategy_account_id) holds
                FROM finance_accounts a WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), run.scope.model_dump())).one()
        assert tuple(row) == (revision, 0)
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_triggered_entry_reuses_frozen_evaluation_and_waits_for_financial_owner():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        repo, run, calls, _ = await prepare(broad, narrow)
        first = await process(repo, run, "tick-1")
        assert first["status"] == "awaiting_finance"
        assert await process(repo, run, "tick-1") == first
        assert await process(repo, run, "tick-2") == first
        assert len(set(calls)) == 1 and len(calls) == 3
        async with narrow.connect() as conn:
            rows = (await conn.execute(text("""
                SELECT request_id,step,payload_json FROM simulation_entry_progress
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**run.scope.model_dump(), "run_id": run.run_id})).mappings().all()
        assert len(rows) == 1 and rows[0]["request_id"] == "request-a"
        assert rows[0]["step"] == "evaluation"
        assert rows[0]["payload_json"]["draft"]["non_authorizing"] is True
        assert rows[0]["payload_json"]["decision"]["account_snapshot_hash"] == run.account_snapshot_hash
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_stop_between_evaluation_and_checkpoint_prevents_financial_dispatch(monkeypatch):
    import moeazi_agent.lifecycle_entry_processor as processor
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        repo, run, calls, _ = await prepare(broad, narrow)
        original = processor.evaluate_entry_request
        async def stopped_after_evaluation(*args):
            result = await original(*args)
            stop = SimulationControl(command_id="stop-mid-evaluation", operation="stop_entries")
            await repo.apply_control(run.scope, run.run_id, run.manifest_hash, stop,
                worker_id="api-fixture", command_id=stop.command_id)
            return result
        monkeypatch.setattr(processor, "evaluate_entry_request", stopped_after_evaluation)
        with pytest.raises(FinanceError, match="checkpoint changed"):
            await process(repo, run, "tick-1")
        assert calls == []
        assert (await process(repo, run, "tick-1"))["status"] == "entries_stopped"
        async with narrow.connect() as conn:
            count = (await conn.execute(text("""
                SELECT count(*) FROM simulation_entry_progress
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**run.scope.model_dump(), "run_id": run.run_id})).scalar_one()
        assert count == 0
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
async def test_terminal_financial_rejection_preserves_request_identity_and_unblocks_queue():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        repo, run, _, _ = await prepare(broad, narrow)
        calls = []
        async def rejected(scope, run_id, digest, request_id, worker_id, command_id):
            calls.append(request_id)
            return {"requestId": request_id, "status": "rejected",
                    "reason": "account_checkpoint_changed"}
        async def forbidden_start(*args, **kwargs):
            raise AssertionError("Rejected entry cannot submit")
        repo.prepare_replay_entry = rejected
        repo.start_order = forbidden_start
        first = await process(repo, run, "rejected-tick-1")
        assert (first["requestId"], first["status"], first["reason"]) == (
            "request-a", "rejected", "account_checkpoint_changed")
        assert await process(repo, run, "rejected-tick-1") == first
        second = await process(repo, run, "rejected-tick-2")
        assert (second["requestId"], second["status"]) == ("request-b", "rejected")
        assert calls == ["request-a", "request-b"]
    finally:
        await narrow.dispose()
        await broad.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [
    {"requestId": "request-b", "status": "awaiting_finance"},
    {"requestId": "request-a", "status": "rejected"},
    {"requestId": "request-a", "status": "rejected", "reason": "x" * 161},
])
async def test_malformed_financial_outcome_cannot_dispose_an_entry(response):
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        repo, run, _, _ = await prepare(broad, narrow)
        async def malformed(*args):
            return response
        repo.prepare_replay_entry = malformed
        with pytest.raises(FinanceError):
            await process(repo, run, "malformed-tick")
        async with narrow.connect() as conn:
            status = (await conn.execute(text("""
                SELECT status FROM simulation_entry_requests
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND request_id='request-a'
            """), {**run.scope.model_dump(), "run_id": run.run_id})).scalar_one()
        assert status == "queued"
    finally:
        await narrow.dispose()
        await broad.dispose()
