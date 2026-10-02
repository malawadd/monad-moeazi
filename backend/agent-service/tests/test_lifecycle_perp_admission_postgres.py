"""Guarded Q4 linear-perp registration through the public experiment pipeline."""
from datetime import timedelta
from hashlib import sha256
import json
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.account_observation_storage import AccountObservationRepository
from moeazi_agent.controller_contracts import ControllerRef
from moeazi_agent.finance_contracts import FinanceScope
from moeazi_agent.finance_observation_contracts import ObservedBalance
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_entry_processor import LifecycleEntryProcessorMixin
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_run_contracts import simulation_dataset_hash
from moeazi_agent.lifecycle_simulator import MODEL_HASH, MODEL_VERSION, simulate_order
from moeazi_agent.lifecycle_state import EntryAuthorityReceipt
from moeazi_agent.lifecycle_strategy import ReplayStrategyRule
from moeazi_agent.observation_contracts import BookLevel, InstrumentVersion, MarketObservation
from moeazi_agent.observation_replay import replay_observations
from moeazi_agent.observation_storage import ObservationRepository
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage2_finance_postgres_sizing import (
    BASE_REGISTRY, QUOTE_REGISTRY, account_observation, policy, reconcile,
)
from test_stage3_lifecycle_contracts import seal
from test_stage3_run_contracts import manifest, scenario
from test_stage3_simulation_database_role import qualification


async def setup_linear_perp_run(engine, *, include_funding=True):
    identity = uuid4().hex
    async with engine.connect() as conn:
        now = (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()
    venue = f"fixtureperp-{identity}"
    definition = InstrumentVersion(
        instrument_version_id=f"{venue}:BTC-USDC:v1", venue_id=venue,
        native_instrument_id="BTC-USDC", product_kind="perpetual",
        base_asset_unit_id=f"{venue}:BTC:8",
        quote_asset_unit_id=f"{venue}:USDC:6",
        settlement_asset_unit_id=f"{venue}:USDC:6",
        base_decimals=8, quote_decimals=6, settlement_decimals=6,
        size_decimals=2, contract_multiplier="0.01",
        price_rule="quote_per_base", lot_step="0.01", min_size="0.01",
        margin_model="linear_v1", funding_model="linear",
        effective_at=now - timedelta(minutes=1),
        registry_hash=sha256(identity.encode()).hexdigest())
    raw = f"perp:{identity}:25000:0.4".encode()
    book = MarketObservation(
        instrument_version_id=definition.instrument_version_id,
        source_id=venue, source_event_id=f"book-{identity}",
        source_kind="synthetic_fault",
        source_rights_ref="local_simulation_fixture_only",
        raw_payload_hash=sha256(raw).hexdigest(), observation_kind="book_snapshot",
        event_at=now - timedelta(seconds=45),
        available_at=now - timedelta(seconds=40),
        received_at=now - timedelta(seconds=40), sequence=None,
        continuity="snapshot_only", finality="not_applicable",
        bids=(BookLevel(price_quote_per_base="24999", size_base="0.4"),),
        asks=(BookLevel(price_quote_per_base="25000", size_base="0.4"),))
    observed = ObservationRepository(engine)
    await observed.register_instrument(definition)
    await observed.ingest_market_observation(definition, book,
        raw_payload_bytes=raw, raw_payload_ref=f"local:perp:{identity}",
        policy_version="q2_internal_research_v1")
    evidence = replay_observations((definition,), (book,), book.received_at, 60_000)
    await observed.store_evidence_snapshot(evidence)
    scope = FinanceScope(environment="experiment", scope_id=f"perp-{identity}",
                         strategy_account_id=f"acct-{identity}")
    collateral = ObservedBalance(asset_unit_id=definition.settlement_asset_unit_id,
        location_id="wallet", book="collateral", units="0",
        registry_hash=QUOTE_REGISTRY)
    snapshot = account_observation(scope, identity, definition, now,
        quote_units="10000000000", extra_balances=(collateral,))
    await AccountObservationRepository(engine).store_experiment_fixture(snapshot)
    finance = FinanceRepository(engine)
    epoch = await finance.acquire_writer_epoch(scope, "stage2-verifier")
    sizing_policy = policy(definition, max_gross="10000000000",
        max_quantity="100", fee_ceiling="100000000")
    await finance.register_policy(scope, epoch, sizing_policy)
    boot = await finance.reconcile_account(reconcile(scope, epoch, 0,
        snapshot, sizing_policy), bootstrap=True)
    assert boot["status"] == "clean"
    stop_body = json.dumps({"scope": scope.model_dump(), "stopped": False},
        sort_keys=True, separators=(",", ":")).encode()
    stop_hash = sha256(b"moeazi-finance-command-v1:set-stop\n" + stop_body).hexdigest()
    opened = await finance.set_account_stop(scope, epoch, boot["revision"],
        stopped=False, idempotency_key="open", request_hash=stop_hash)
    rule = seal(ReplayStrategyRule, "moeazi-replay-strategy-rule-v1", "rule_hash",
        dict(schema_version=1, instrument_version_id=definition.instrument_version_id,
            action="perp_open", side="buy", trigger="always",
            threshold_price_quote_per_base=None, desired_quantity_units="10",
            horizon_seconds=60, rationale_summary="Exact local linear perp"))
    cursor = evidence.cutoff_at + timedelta(milliseconds=1)
    funding_rules = ({"order_ordinal": 1, "source_event_id": "funding-3-usdc",
        "instrument_version_id": definition.instrument_version_id,
        "at_cursor": cursor + timedelta(seconds=1),
        "asset_unit_id": definition.settlement_asset_unit_id,
        "registry_hash": QUOTE_REGISTRY, "signed_units": "-3000000"},) \
        if include_funding else ()
    frozen = scenario(model_version=MODEL_VERSION, model_hash=MODEL_HASH,
        dataset_hash=simulation_dataset_hash((book,)),
        simulation_cursor_at=cursor, evidence_cutoff_at=evidence.cutoff_at,
        simulation_end_at=cursor + timedelta(minutes=2),
        max_book_age_ms=60_000, fee_bps=10, fee_rules=(),
        funding_rules=funding_rules,
        outcome_rules=())
    controller = ControllerRef(schemaVersion=1, environment="experiment",
        strategyAccountId=scope.strategy_account_id, controllerKind="customer_team",
        controllerId=scope.scope_id, controllerVersionId=f"{scope.scope_id}:v1",
        contentHash="a" * 64)
    run = manifest(scope=scope, controller_ref=controller,
        run_id=f"linear-perp-{identity}", controller_mode="shadow",
        strategy_artifact_hash=rule.rule_hash,
        policy_version=sizing_policy.policy_version, policy_hash=sizing_policy.policy_hash,
        instrument_version_ids=(definition.instrument_version_id,),
        evidence_snapshot_hash=evidence.snapshot_hash,
        account_snapshot_hash=snapshot.snapshot_hash, scenario=frozen)

    async def authorize(request):
        async with engine.connect() as conn:
            checked = (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()
        return EntryAuthorityReceipt(schema_version=1, scope=request.scope,
            run_id=request.run_id, controller_ref=request.controller_ref,
            controller_mode=request.controller_mode,
            created_by_subject=request.created_by_subject,
            experiment_request_hash=request.experiment_request_hash,
            authority_fingerprint=request.registered_authority_fingerprint,
            checked_at=checked)

    repo = SimulationLifecycleRepository(finance, simulator=simulate_order,
                                         entry_authorizer=authorize)
    await repo.register_run(run, created_by_subject="dataset-owner",
        experiment_request_hash="b" * 64, authority_fingerprint="a" * 64,
        expected_revision=opened["revision"], idempotency_key=f"register-{identity}")
    await repo.register_run_dataset(scope, run.run_id, run.manifest_hash,
        (evidence.accepted_observation_hashes[0],), "dataset-owner")
    return repo, run, rule


@pytest.mark.asyncio
@pytest.mark.parametrize("include_funding", [False, True])
async def test_linear_perp_public_pipeline_keeps_finance_gate_closed(include_funding):
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        source_repo, run, rule = await setup_linear_perp_run(
            broad, include_funding=include_funding)
        repo = SimulationLifecycleRepository(FinanceRepository(narrow),
            simulator=simulate_order,
            entry_authorizer=source_repo.entry_authorizer)
        await repo.queue_entry_request(run.scope, run.run_id, run.manifest_hash,
                                       rule, "dataset-owner", "perp-entry-1")
        result = await LifecycleEntryProcessorMixin.process_next_entry_request(
            repo, run.scope, run.run_id, run.manifest_hash,
            "stage2-verifier", "perp-evaluate-1")
        assert result["status"] == "awaiting_finance"
        assert result["reason"] == "replay_order_preparation_unavailable"
        async with narrow.connect() as conn:
            holds = (await conn.execute(text("""
                SELECT count(*) FROM finance_reservations
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), run.scope.model_dump())).scalar_one()
        assert holds == 0
    finally:
        await narrow.dispose()
        await broad.dispose()
