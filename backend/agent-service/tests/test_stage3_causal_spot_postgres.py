"""Guarded public causal spot replay through a settled financial hold."""
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
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage2_finance_postgres_sizing import setup_spot_account
from test_stage3_lifecycle_contracts import H, seal
from test_stage3_run_contracts import manifest, scenario
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
async def test_public_causal_spot_order_folds_checkpoints_and_settles():
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        identity = uuid4().hex
        _, scope, _, instrument, snapshot, evidence, policy, opened = \
            await setup_spot_account(broad, identity, quote_units="1000000000",
                max_gross="1000000000", max_quantity="10000000",
                fee_ceiling="1000000")
        async with broad.connect() as conn:
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
                rationale_summary="Exact causal spot replay"))
        frozen = scenario(model_version=CAUSAL_MODEL_VERSION,
            model_hash=CAUSAL_MODEL_HASH,
            dataset_hash=simulation_dataset_hash((book,)),
            fee_rules=(), funding_rules=(), outcome_rules=(),
            evidence_cutoff_at=evidence.cutoff_at,
            simulation_cursor_at=evidence.cutoff_at,
            simulation_end_at=evidence.cutoff_at + timedelta(seconds=2),
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
            controllerVersionId="causal-version", contentHash=H)
        run = manifest(scope=scope, controller_ref=controller,
            run_id=f"causal-spot-{identity}", controller_mode="shadow",
            strategy_artifact_hash=rule.rule_hash,
            policy_version=policy.policy_version, policy_hash=policy.policy_hash,
            instrument_version_ids=(instrument.instrument_version_id,),
            evidence_snapshot_hash=evidence.snapshot_hash,
            account_snapshot_hash=snapshot.snapshot_hash,
            scenario=frozen, protection_policy=protection)

        async def authorizer(request):
            async with narrow.connect() as conn:
                checked_at = (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()
            return EntryAuthorityReceipt(schema_version=1, scope=request.scope,
                run_id=request.run_id, controller_ref=request.controller_ref,
                controller_mode=request.controller_mode,
                created_by_subject=request.created_by_subject,
                experiment_request_hash=request.experiment_request_hash,
                authority_fingerprint=request.registered_authority_fingerprint,
                checked_at=checked_at)

        repo = SimulationLifecycleRepository(FinanceRepository(narrow),
            simulator=simulate_order, entry_authorizer=authorizer)
        await repo.register_run(run, created_by_subject="dataset-owner",
            experiment_request_hash=H, authority_fingerprint=H,
            expected_revision=opened["revision"],
            idempotency_key=f"register-{identity}")
        await repo.register_run_dataset(scope, run.run_id, run.manifest_hash,
            (canonical_hash(book.model_dump(mode="json")),), "dataset-owner")
        await repo.queue_entry_request(scope, run.run_id, run.manifest_hash,
            rule, "dataset-owner", "entry-1")
        evaluated = await LifecycleEntryProcessorMixin.process_next_entry_request(
            repo, scope, run.run_id, run.manifest_hash,
            "stage2-verifier", "evaluate-entry-1")
        assert evaluated["status"] == "submission_possible", evaluated
        params = {**scope.model_dump(), "run_id": run.run_id}
        async with narrow.connect() as conn:
            row = (await conn.execute(text("""
                SELECT c.receipt_json,o.permit_json FROM simulation_orders o
                JOIN finance_calculation_receipts c ON
                  c.environment=o.environment AND c.scope_id=o.scope_id AND
                  c.strategy_account_id=o.strategy_account_id AND
                  c.receipt_hash=(SELECT p.calculation_receipt_hash
                    FROM simulation_order_preparations p WHERE
                    p.environment=o.environment AND p.scope_id=o.scope_id AND
                    p.strategy_account_id=o.strategy_account_id AND
                    p.run_id=o.run_id AND p.order_id=o.order_id)
                WHERE o.environment=:environment AND o.scope_id=:scope_id AND
                  o.strategy_account_id=:strategy_account_id AND o.run_id=:run_id
            """), params)).mappings().one()
        assert row["receipt_json"]["code_version"] == "replay-sizing-v2"
        assert row["permit_json"]["execution_envelope"]["envelope_hash"] == \
            row["receipt_json"]["execution_envelope"]["envelope_hash"]
        for step in range(24):
            await repo.advance_run(scope, run.run_id, run.manifest_hash,
                "stage2-verifier", f"causal-advance-{step}")
            async with narrow.connect() as conn:
                settled = (await conn.execute(text("""
                    SELECT count(*) FROM finance_reservations WHERE
                      environment=:environment AND scope_id=:scope_id AND
                      strategy_account_id=:strategy_account_id AND status='settled'
                """), params)).scalar_one()
            if settled:
                break
        assert settled == 1, "public causal replay never settled its hold"
        async with narrow.connect() as conn:
            folded = (await conn.execute(text("""
                SELECT count(*) FROM simulation_event_folds WHERE
                  environment=:environment AND scope_id=:scope_id AND
                  strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), params)).scalar_one()
            checkpoints = (await conn.execute(text("""
                SELECT count(*) FROM finance_reconciliation_checkpoints WHERE
                  environment=:environment AND scope_id=:scope_id AND
                  strategy_account_id=:strategy_account_id
            """), params)).scalar_one()
        assert folded > 0 and checkpoints > 0
    finally:
        await narrow.dispose()
        await broad.dispose()
