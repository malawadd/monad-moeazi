"""Public causal spot entry followed by a source-backed owner close."""
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.controller_contracts import ControllerRef
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_entry_processor import LifecycleEntryProcessorMixin
from moeazi_agent.lifecycle_execution_envelope import CAUSAL_MODEL_VERSION
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_run_contracts import (
    ExperimentProtectionPolicyV1, simulation_dataset_hash,
)
from moeazi_agent.lifecycle_simulator import CAUSAL_MODEL_HASH, simulate_order
from moeazi_agent.lifecycle_state import EntryAuthorityReceipt
from moeazi_agent.lifecycle_strategy import ReplayStrategyRule
from moeazi_agent.observation_contracts import MarketObservation, canonical_hash
from moeazi_agent.simulation_workflow_contracts import SimulationControl
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage2_finance_postgres_sizing import setup_spot_account
from test_stage3_lifecycle_contracts import H, seal
from test_stage3_run_contracts import manifest, scenario
from test_stage3_simulation_database_role import qualification


async def setup_causal_spot_maintenance(engine):
    identity = uuid4().hex
    _, scope, _, instrument, snapshot, evidence, policy, opened = \
        await setup_spot_account(engine, identity, quote_units="1000000000",
            max_gross="1000000000", max_quantity="10000000",
            fee_ceiling="1000000")
    async with engine.connect() as conn:
        source = (await conn.execute(text("""
            SELECT normalized_body FROM observation_market_events
            WHERE observation_hash=:hash
        """), {"hash": evidence.accepted_observation_hashes[0]})).scalar_one()
    book = MarketObservation.model_validate(source)
    rule = seal(ReplayStrategyRule, "moeazi-replay-strategy-rule-v1",
        "rule_hash", dict(schema_version=1,
            instrument_version_id=instrument.instrument_version_id,
            action="spot_buy", side="buy", trigger="always",
            threshold_price_quote_per_base=None,
            desired_quantity_units="1000000", horizon_seconds=60,
            rationale_summary="Exact causal spot entry and owner close"))
    frozen = scenario(model_version=CAUSAL_MODEL_VERSION,
        model_hash=CAUSAL_MODEL_HASH,
        dataset_hash=simulation_dataset_hash((book,)),
        fee_rules=(), funding_rules=(), outcome_rules=(),
        evidence_cutoff_at=evidence.cutoff_at,
        simulation_cursor_at=evidence.cutoff_at,
        simulation_end_at=evidence.cutoff_at + timedelta(seconds=10),
        protection_outcome_model="confirm",
        max_execution_deviation_bps=500,
        order_time_in_force_ms=500, max_fill_events_per_order=4)
    protection = seal(ExperimentProtectionPolicyV1,
        "moeazi-experiment-protection-policy-v1", "policy_hash",
        dict(schema_version=1,
            policy_version="bounded-historical-unprotected-v1",
            maximum_unprotected_seconds=1,
            allow_increases_before_deadline=True,
            deadline_action="stop_and_escalate"))
    controller = ControllerRef(schemaVersion=1,
        environment="experiment", strategyAccountId=scope.strategy_account_id,
        controllerKind="customer_team", controllerId=scope.scope_id,
        controllerVersionId="maintenance-version", contentHash=H)
    run = manifest(scope=scope, controller_ref=controller,
        run_id=f"causal-maintenance-{identity}", controller_mode="shadow",
        strategy_artifact_hash=rule.rule_hash,
        policy_version=policy.policy_version, policy_hash=policy.policy_hash,
        instrument_version_ids=(instrument.instrument_version_id,),
        evidence_snapshot_hash=evidence.snapshot_hash,
        account_snapshot_hash=snapshot.snapshot_hash,
        scenario=frozen, protection_policy=protection)
    return scope, run, rule, book, opened


async def _run_until(repo, scope, run, predicate, label):
    for step in range(24):
        await repo.advance_run(scope, run.run_id, run.manifest_hash,
            "stage2-verifier", f"{label}-{step}")
        if await predicate():
            return
    pytest.fail(f"public replay never reached {label}")


@pytest.mark.asyncio
@pytest.mark.parametrize("dispatch", ["direct", "worker"])
async def test_owner_close_consumes_source_reduces_position_and_proves_flat(dispatch):
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        scope, run, rule, book, opened = await setup_causal_spot_maintenance(broad)

        async def authorizer(request):
            async with narrow.connect() as conn:
                checked = (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()
            return EntryAuthorityReceipt(schema_version=1, scope=request.scope,
                run_id=request.run_id, controller_ref=request.controller_ref,
                controller_mode=request.controller_mode,
                created_by_subject=request.created_by_subject,
                experiment_request_hash=request.experiment_request_hash,
                authority_fingerprint=request.registered_authority_fingerprint,
                checked_at=checked)

        repo = SimulationLifecycleRepository(FinanceRepository(narrow),
            simulator=simulate_order, entry_authorizer=authorizer)
        await repo.register_run(run, created_by_subject="dataset-owner",
            experiment_request_hash=H, authority_fingerprint=H,
            expected_revision=opened["revision"],
            idempotency_key=f"register-{run.run_id}")
        await repo.register_run_dataset(scope, run.run_id, run.manifest_hash,
            (canonical_hash(book.model_dump(mode="json")),), "dataset-owner")
        await repo.queue_entry_request(scope, run.run_id, run.manifest_hash,
            rule, "dataset-owner", "entry-1")
        entered = await LifecycleEntryProcessorMixin.process_next_entry_request(
            repo, scope, run.run_id, run.manifest_hash,
            "stage2-verifier", "evaluate-entry-1")
        assert entered["status"] == "submission_possible", entered
        params = {**scope.model_dump(), "run_id": run.run_id}

        async def entry_settled():
            async with narrow.connect() as conn:
                row = (await conn.execute(text("""
                    SELECT count(*) FROM finance_reservations
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id
                      AND status='settled'
                """), params)).scalar_one()
                return row == 1

        await _run_until(repo, scope, run, entry_settled, "first-settlement")
        command = SimulationControl(command_id=f"owner-close-{uuid4()}",
            operation="request_close",
            instrument_version_id=run.instrument_version_ids[0])
        applied = await repo.apply_control(scope, run.run_id, run.manifest_hash,
            command, worker_id="api-fixture", command_id=command.command_id,
            requested_by_subject="dataset-owner")
        assert applied["outcome"] == "applied"
        stop_command = SimulationControl(command_id=f"stop-{uuid4()}",
            operation="stop_entries")
        stopped = await repo.apply_control(scope, run.run_id, run.manifest_hash,
            stop_command, worker_id="api-fixture", command_id=stop_command.command_id,
            requested_by_subject="dataset-owner")
        assert stopped["outcome"] == "applied"
        if dispatch == "direct":
            issued = await repo.issue_maintenance_reduction(scope, run.run_id,
                run.manifest_hash, command.command_id, worker_id="stage2-verifier")
            assert issued["status"] == "prepared", issued
            started = await repo.start_order(scope, run.run_id, issued["orderId"],
                worker_id="stage2-verifier")
            assert started["status"] == "submission_possible"
        else:
            issued = None

        async def close_settled():
            async with narrow.connect() as conn:
                row = (await conn.execute(text("""
                    SELECT count(*) FROM finance_reservations
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id
                      AND status='settled'
                """), params)).scalar_one()
                return row == 2

        if dispatch == "worker":
            async def worker_complete():
                if not await close_settled():
                    return False
                async with narrow.connect() as conn:
                    return (await conn.execute(text("""
                        SELECT count(*) FROM simulation_flat_resolutions
                        WHERE environment=:environment AND scope_id=:scope_id
                          AND strategy_account_id=:strategy_account_id
                          AND run_id=:run_id
                    """), params)).scalar_one() == 1
            await _run_until(repo, scope, run, worker_complete, "worker-flat-proof")
        else:
            await _run_until(repo, scope, run, close_settled, "close-settlement")
            resolved = await repo.resolve_flat_positions(scope, run.run_id,
                run.manifest_hash, worker_id="stage2-verifier",
                command_id=f"flat-{uuid4()}")
            assert resolved["resolved"] is True, resolved
        async with narrow.connect() as conn:
            mandate = (await conn.execute(text("""
                SELECT maintenance_order_id,receipt_hash,intent_id,reservation_id
                FROM simulation_maintenance_reductions
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND command_id=:command_id
            """), {**params, "command_id": command.command_id})).mappings().one()
            if issued is None:
                issued = {"orderId": mandate["maintenance_order_id"],
                    "maintenanceReceiptHash": mandate["receipt_hash"],
                    "intentId": mandate["intent_id"],
                    "reservationId": mandate["reservation_id"]}
            permit = (await conn.execute(text("""
                SELECT permit_json FROM simulation_orders
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND order_id=:order_id
            """), {**params, "order_id": issued["orderId"]})).scalar_one()
            position = (await conn.execute(text("""
                SELECT signed_exposure_units FROM simulation_positions
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
            source = (await conn.execute(text("""
                SELECT kind FROM simulation_order_events
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND order_id=:order_id ORDER BY sequence
            """), {**params, "order_id": issued["orderId"]})).scalars().all()
            proof = (await conn.execute(text("""
                SELECT count(*) FROM simulation_flat_resolutions
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
        assert int(position) == 0
        assert permit["maintenance_receipt_hash"] == issued["maintenanceReceiptHash"]
        assert permit["protection_order_id"] == issued["orderId"]
        assert permit["intent_id"] == issued["intentId"]
        assert "protection_accepted" in source and "fill" in source
        assert proof == 1
        before_finish = await repo.read_run(scope, run.run_id, run.manifest_hash)
        assert before_finish.status != "completed_flat"
        async with narrow.connect() as conn:
            before_cursor = (await conn.execute(text("""
                SELECT replay_cursor_at FROM simulation_runs
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
        assert before_cursor < run.scenario.simulation_end_at
        for step in range(12):
            finished = await repo.advance_run(scope, run.run_id, run.manifest_hash,
                "stage2-verifier", f"finish-horizon-{run.run_id}-{step}")
            if finished.status == "completed_flat":
                break
        else:
            pytest.fail("clean owner-close replay did not finish its frozen horizon")
        async with narrow.connect() as conn:
            completion = (await conn.execute(text("""
                SELECT r.status,r.replay_cursor_at,a.observation_snapshot_hash,
                  EXISTS(SELECT 1 FROM simulation_derived_snapshots d
                    WHERE d.environment=r.environment AND d.scope_id=r.scope_id
                      AND d.strategy_account_id=r.strategy_account_id AND d.run_id=r.run_id
                      AND d.manifest_hash=r.manifest_hash
                      AND d.replay_cursor_at=r.replay_cursor_at
                      AND d.snapshot_hash=a.observation_snapshot_hash) AS checkpoint_at_end
                FROM simulation_runs r JOIN finance_accounts a
                  ON a.environment=r.environment AND a.scope_id=r.scope_id
                  AND a.strategy_account_id=r.strategy_account_id
                WHERE r.environment=:environment AND r.scope_id=:scope_id
                  AND r.strategy_account_id=:strategy_account_id AND r.run_id=:run_id
            """), params)).mappings().one()
        assert completion["status"] == "completed_flat"
        assert completion["replay_cursor_at"] == run.scenario.simulation_end_at
        assert completion["checkpoint_at_end"] is True
        if dispatch == "direct":
            retried = await repo.issue_maintenance_reduction(scope, run.run_id,
                run.manifest_hash, command.command_id, worker_id="stage2-verifier")
            assert {key: retried[key] for key in (
                "orderId", "intentId", "reservationId", "maintenanceReceiptHash"
            )} == {key: issued[key] for key in (
                "orderId", "intentId", "reservationId", "maintenanceReceiptHash")}
    finally:
        await narrow.dispose()
        await broad.dispose()
