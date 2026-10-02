"""Actual restricted Q4 replay receipt and multi-row hold admission."""
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.controller_contracts import ControllerRef
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_entry_processor import LifecycleEntryProcessorMixin
from moeazi_agent.lifecycle_replay_entry import LifecycleReplayEntryMixin
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_run_contracts import simulation_dataset_hash
from moeazi_agent.lifecycle_simulator import MODEL_HASH, MODEL_VERSION, simulate_order
from moeazi_agent.lifecycle_state import EntryAuthorityReceipt
from moeazi_agent.lifecycle_strategy import ReplayStrategyRule
from moeazi_agent.finance_observation_contracts import ObservedBalance
from moeazi_agent.observation_contracts import MarketObservation, canonical_hash
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage2_finance_postgres_sizing import setup_spot_account
from test_stage3_lifecycle_contracts import H, seal
from test_stage3_run_contracts import manifest, scenario
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
@pytest.mark.parametrize("eth_units", [None, "10000000000000000", "0"])
async def test_replay_entry_persists_exact_receipt_hold_and_intent_before_preparation(
        eth_units):
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        identity = uuid4().hex
        extra = () if eth_units is None else (ObservedBalance(
            asset_unit_id="ETH:18", location_id="wallet", book="wallet",
            units=eth_units, registry_hash=H),)
        _, scope, _, instrument, snapshot, evidence, policy, opened = \
            await setup_spot_account(broad, identity, quote_units="1000000000",
                max_gross="1000000000", max_quantity="100000000",
                fee_ceiling="1000000", extra_balances=extra)
        async with broad.connect() as conn:
            book_body = (await conn.execute(text("""
                SELECT normalized_body FROM observation_market_events
                WHERE observation_hash=:hash
            """), {"hash": evidence.accepted_observation_hashes[0]})).scalar_one()
        book = MarketObservation.model_validate(book_body)
        rule = seal(ReplayStrategyRule, "moeazi-replay-strategy-rule-v1", "rule_hash",
            dict(schema_version=1, instrument_version_id=instrument.instrument_version_id,
                action="spot_buy", side="buy", trigger="always",
                threshold_price_quote_per_base=None,
                desired_quantity_units="1000000", horizon_seconds=60,
                rationale_summary="Exact local replay entry"))
        fee_rules = () if eth_units is None else ({"order_ordinal": 1,
            "fill_ordinal": 1, "asset_unit_id": "ETH:18",
            "registry_hash": H, "units": "1000000000000000"},)
        frozen = scenario(model_version=MODEL_VERSION, model_hash=MODEL_HASH,
            dataset_hash=simulation_dataset_hash((book,)), fee_rules=fee_rules,
            funding_rules=(), outcome_rules=(), evidence_cutoff_at=evidence.cutoff_at,
            simulation_cursor_at=evidence.cutoff_at,
            simulation_end_at=evidence.cutoff_at + timedelta(seconds=2))
        controller = ControllerRef(schemaVersion=1, environment="experiment",
            strategyAccountId=scope.strategy_account_id, controllerKind="customer_team",
            controllerId=scope.scope_id, controllerVersionId="replay-version",
            contentHash=H)
        run = manifest(scope=scope, controller_ref=controller,
            run_id=f"replay-entry-{identity}", controller_mode="shadow",
            strategy_artifact_hash=rule.rule_hash,
            policy_version=policy.policy_version, policy_hash=policy.policy_hash,
            instrument_version_ids=(instrument.instrument_version_id,),
            evidence_snapshot_hash=evidence.snapshot_hash,
            account_snapshot_hash=snapshot.snapshot_hash, scenario=frozen)

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
            expected_revision=opened["revision"], idempotency_key=f"register-{identity}")
        await repo.register_run_dataset(scope, run.run_id, run.manifest_hash,
            (canonical_hash(book.model_dump(mode="json")),), "dataset-owner")
        await repo.queue_entry_request(scope, run.run_id, run.manifest_hash,
                                       rule, "dataset-owner", "entry-1")
        evaluated = await LifecycleEntryProcessorMixin.process_next_entry_request(
            repo, scope, run.run_id, run.manifest_hash,
            "stage2-verifier", "evaluate-entry-1")
        if eth_units == "0":
            assert evaluated["status"] == "rejected"
            assert evaluated["reason"] == "replay_capacity_denied"
            async with narrow.connect() as conn:
                holds = (await conn.execute(text("""
                    SELECT count(*) FROM finance_reservations
                    WHERE environment=:environment AND scope_id=:scope_id
                      AND strategy_account_id=:strategy_account_id
                """), scope.model_dump())).scalar_one()
            assert holds == 0
            return
        assert evaluated["status"] == "submission_possible"
        prepared = await LifecycleReplayEntryMixin.prepare_replay_entry(repo,
            scope, run.run_id, run.manifest_hash, "entry-1", "stage2-verifier",
            "admit-entry-1")
        assert prepared["status"] == "prepared"
        retry = await LifecycleReplayEntryMixin.prepare_replay_entry(repo,
            scope, run.run_id, run.manifest_hash, "entry-1", "stage2-verifier",
            "admit-entry-1")
        assert retry == prepared
        started = await repo.start_order(scope, run.run_id, prepared["orderId"],
                                         worker_id="stage2-verifier")
        assert started["status"] == "duplicate"
        assert (await repo.start_order(scope, run.run_id, prepared["orderId"],
                                      worker_id="stage2-verifier"))["status"] == "duplicate"
        async with narrow.connect() as conn:
            row = (await conn.execute(text("""
                SELECT a.revision,
                  (SELECT count(*) FROM finance_reservations r WHERE r.environment=a.environment
                    AND r.scope_id=a.scope_id AND r.strategy_account_id=a.strategy_account_id) holds,
                  (SELECT count(*) FROM finance_calculation_receipts c
                    WHERE c.environment=a.environment AND c.scope_id=a.scope_id
                      AND c.strategy_account_id=a.strategy_account_id) receipts,
                  (SELECT count(*) FROM simulation_intents i WHERE i.environment=a.environment
                    AND i.scope_id=a.scope_id AND i.strategy_account_id=a.strategy_account_id
                    AND i.run_id=:run_id) intents,
                  (SELECT count(*) FROM simulation_order_preparations p
                    WHERE p.environment=a.environment AND p.scope_id=a.scope_id
                      AND p.strategy_account_id=a.strategy_account_id AND p.run_id=:run_id) prepared,
                  (SELECT count(*) FROM simulation_orders o WHERE o.environment=a.environment
                    AND o.scope_id=a.scope_id AND o.strategy_account_id=a.strategy_account_id
                    AND o.run_id=:run_id) orders
                FROM finance_accounts a WHERE a.environment=:environment
                  AND a.scope_id=:scope_id AND a.strategy_account_id=:strategy_account_id
            """), {**scope.model_dump(), "run_id": run.run_id})).one()
        assert tuple(row) == (opened["revision"] + 2, 1, 1, 1, 1, 1)
        if eth_units is not None:
            async with narrow.connect() as conn:
                eth_hold = (await conn.execute(text("""
                    SELECT c.units FROM finance_reservation_components c
                    WHERE c.environment=:environment AND c.scope_id=:scope_id
                      AND c.strategy_account_id=:strategy_account_id
                      AND c.asset_unit_id='ETH:18'
                """), scope.model_dump())).scalar_one()
            assert int(eth_hold) == 1000000000000000
        async with narrow.begin() as conn:
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**scope.model_dump(), "run_id": run.run_id,
                   "cursor": run.scenario.simulation_end_at})
        folded = await repo.fold_order_events(scope, run.run_id,
            prepared["orderId"], worker_id="stage2-verifier",
            command_id="fold-replay-entry")
        assert folded["foldedCount"] > 0
        async with narrow.connect() as conn:
            obligations = (await conn.execute(text("""
                SELECT count(*) FROM simulation_protections
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
                  AND status='intended' AND originating_order_id=:order_id
            """), {**scope.model_dump(), "run_id": run.run_id,
                   "order_id": prepared["orderId"]})).scalar_one()
        assert obligations > 0
    finally:
        await narrow.dispose()
        await broad.dispose()
