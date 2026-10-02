"""Q3 market/account evidence binding against root-managed disposable PostgreSQL."""
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.account_observation_storage import (
    AccountObservationRepository, account_snapshot_hash,
)
from moeazi_agent.finance_contracts import (
    FinanceError, FinanceScope, ReconcileCommand, semantic_request_hash,
)
from moeazi_agent.finance_observation_contracts import (
    AccountObservationSnapshotRef, ObservedBalance,
)
from moeazi_agent.finance_policy import SizingPolicy, SizingRequest
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.native_observations import hyperliquid_book_observation
from moeazi_agent.observation_contracts import InstrumentVersion
from moeazi_agent.observation_replay import replay_observations
from moeazi_agent.observation_storage import ObservationRepository


BASE_REGISTRY = "b" * 64
QUOTE_REGISTRY = "c" * 64
HASH = "a" * 64


def guarded_dsn():
    raw = os.getenv("MOEAZI_TEST_POSTGRES_DSN")
    if not raw:
        pytest.skip("SQL055 requires explicit disposable local PostgreSQL DSN")
    url = make_url(raw)
    if (url.drivername, url.host, url.port, url.database) != (
            "postgresql+asyncpg", "127.0.0.1", 15432, "moeazi_q3_20260930"):
        pytest.fail("Q3 harness is restricted to root's disposable loopback database")
    return raw


def policy(instrument, max_gross="100000000000", max_quantity="100000000",
           fee_ceiling="0"):
    body = dict(policy_version="q3-spot-binder-v1",
        instrument_version_id=instrument.instrument_version_id,
        max_quantity_units=max_quantity, min_quantity_units="1",
        quantity_step_units="1", max_gross_notional_units=max_gross,
        max_directional_notional_units=max_gross, initial_margin_bps=1000,
        fee_ceiling_units=fee_ceiling, exit_buffer_units="0",
        max_observation_age_seconds=3600, max_reservation_seconds=60,
        approved_live=False)
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"),
        ensure_ascii=False).encode()
    digest = hashlib.sha256(b"moeazi-finance-policy-v1\n" + canonical).hexdigest()
    return SizingPolicy(**body, policy_hash=digest)


def account_observation(scope, identity, instrument, now, base_units="0",
                        quote_units="1000000000", extra_balances=()):
    event_at = now - timedelta(seconds=45)
    provisional = AccountObservationSnapshotRef(
        scope=scope, snapshot_hash="0" * 64, source_account_id=f"fixture:{identity}",
        origin="recorded_fixture", status="accepted", event_at=event_at,
        available_at=event_at, received_at=event_at,
        cutoff_at=now - timedelta(seconds=40),
        finality="admitted_final", finality_at=event_at,
        has_gap=False, has_reorg=False, balances_complete=True,
        positions_complete=True, rights_ref="internal_qualification_only",
        source_event_hash=hashlib.sha256(f"event:{identity}".encode()).hexdigest(),
        source_payload_hash=hashlib.sha256(f"payload:{identity}".encode()).hexdigest(),
        registry_hash=instrument.registry_hash, policy_version="q3-spot-binder-v1",
        observed_balances=(
            ObservedBalance(asset_unit_id=instrument.base_asset_unit_id,
                location_id="wallet", book="wallet", units=base_units,
                registry_hash=BASE_REGISTRY),
            ObservedBalance(asset_unit_id=instrument.quote_asset_unit_id,
                location_id="wallet", book="wallet", units=quote_units,
                registry_hash=QUOTE_REGISTRY),
            *extra_balances), observed_positions=())
    return AccountObservationSnapshotRef.model_validate(provisional.model_dump() | {
        "snapshot_hash": account_snapshot_hash(provisional)})


def reconcile(scope, epoch, revision, snapshot, sizing_policy):
    body = dict(scope=scope, expected_revision=revision, writer_epoch=epoch,
        idempotency_key="bootstrap", request_hash=HASH,
        snapshot_hash=snapshot.snapshot_hash,
        policy_version=sizing_policy.policy_version, policy_hash=sizing_policy.policy_hash)
    return ReconcileCommand.model_validate(body | {
        "request_hash": semantic_request_hash("reconcile",
            ReconcileCommand.model_construct(**body))})


async def setup_spot_account(engine, identity, *, quote_units="100", ask="100",
                             max_gross="100", max_quantity="100",
                             fee_ceiling="0", extra_balances=()):
    async with engine.connect() as conn:
        now = (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()
    instrument = InstrumentVersion(
        instrument_version_id=f"hyperliquid:spot:race:{identity}",
        venue_id="hyperliquid", native_instrument_id=f"BTC/USDC:{identity}",
        product_kind="spot", base_asset_unit_id=f"BTC:8:{identity}",
        quote_asset_unit_id=f"USDC:6:{identity}",
        settlement_asset_unit_id=f"USDC:6:{identity}", base_decimals=8,
        quote_decimals=6, settlement_decimals=6, size_decimals=8,
        contract_multiplier="1", price_rule="hyperliquid_spot_significant_figures_v1",
        lot_step="0.00000001", margin_model="not_applicable",
        funding_model="not_applicable", effective_at=now - timedelta(minutes=1),
        registry_hash=hashlib.sha256(identity.encode()).hexdigest())
    raw = json.dumps({"coin": instrument.native_instrument_id,
        "time": int((now - timedelta(seconds=42)).timestamp() * 1000),
        "levels": [[{"px": "99", "sz": "1"}], [{"px": ask, "sz": "1"}]]},
        separators=(",", ":")).encode()
    book = hyperliquid_book_observation(raw, instrument,
        received_at=now - timedelta(seconds=40),
        source_rights_ref="internal_qualification_only")
    observed = ObservationRepository(engine)
    await observed.register_instrument(instrument)
    await observed.ingest_market_observation(instrument, book, raw_payload_bytes=raw,
        raw_payload_ref=f"local:stage2:{identity}",
        policy_version="q2_internal_research_v1")
    evidence = replay_observations([instrument], [book],
        now - timedelta(seconds=40), 60_000)
    await observed.store_evidence_snapshot(evidence)
    scope = FinanceScope(environment="experiment", scope_id=f"q3-{identity}",
        strategy_account_id=f"acct-{identity}")
    snapshot = account_observation(scope, identity, instrument, now,
        quote_units=quote_units, extra_balances=extra_balances)
    await AccountObservationRepository(engine).store_experiment_fixture(snapshot)
    repository = FinanceRepository(engine)
    epoch = await repository.acquire_writer_epoch(scope, "stage2-verifier")
    sizing_policy = policy(instrument, max_gross=max_gross,
        max_quantity=max_quantity, fee_ceiling=fee_ceiling)
    await repository.register_policy(scope, epoch, sizing_policy)
    boot = await repository.reconcile_account(reconcile(scope, epoch, 0,
        snapshot, sizing_policy), bootstrap=True)
    assert boot["status"] == "clean", boot
    stop_body = json.dumps({"scope": scope.model_dump(), "stopped": False},
        sort_keys=True, separators=(",", ":")).encode()
    stop_hash = hashlib.sha256(b"moeazi-finance-command-v1:set-stop\n"
        + stop_body).hexdigest()
    opened = await repository.set_account_stop(scope, epoch, boot["revision"],
        stopped=False, idempotency_key="open", request_hash=stop_hash)
    return repository, scope, epoch, instrument, snapshot, evidence, sizing_policy, opened


@pytest.mark.asyncio
async def test_spot_sizing_rejects_forged_cheap_price_and_unobserved_exposure():
    engine = create_async_engine(guarded_dsn())
    identity = uuid4().hex
    async with engine.connect() as conn:
        now = (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()
    instrument = InstrumentVersion(
        instrument_version_id=f"hyperliquid:spot:test:{identity}",
        venue_id="hyperliquid", native_instrument_id=f"BTC/USDC:{identity}",
        product_kind="spot", base_asset_unit_id=f"BTC:8:{identity}",
        quote_asset_unit_id=f"USDC:6:{identity}",
        settlement_asset_unit_id=f"USDC:6:{identity}", base_decimals=8,
        quote_decimals=6, settlement_decimals=6, size_decimals=8,
        contract_multiplier="1", price_rule="hyperliquid_spot_significant_figures_v1",
        lot_step="0.00000001", margin_model="not_applicable",
        funding_model="not_applicable", effective_at=now - timedelta(minutes=1),
        registry_hash=hashlib.sha256(identity.encode()).hexdigest())
    scope = FinanceScope(environment="experiment", scope_id=f"q3-{identity}",
        strategy_account_id=f"acct-{identity}")
    repository = FinanceRepository(engine)
    try:
        native = json.dumps({"coin": instrument.native_instrument_id,
            "time": int((now - timedelta(seconds=42)).timestamp() * 1000),
            "levels": [[{"px": "25000", "sz": "1"}],
                       [{"px": "25001", "sz": "1"}]]},
            separators=(",", ":")).encode()
        book = hyperliquid_book_observation(native, instrument,
            received_at=now - timedelta(seconds=40),
            source_rights_ref="internal_qualification_only")
        observations = ObservationRepository(engine)
        await observations.register_instrument(instrument)
        await observations.ingest_market_observation(instrument, book,
            raw_payload_bytes=native, raw_payload_ref=f"local:stage2:{identity}",
            policy_version="q2_internal_research_v1")
        evidence = replay_observations([instrument], [book],
            now - timedelta(seconds=40), 60_000)
        assert len(evidence.accepted_observation_hashes) == 1
        await observations.store_evidence_snapshot(evidence)
        snapshot = account_observation(scope, identity, instrument, now)
        await AccountObservationRepository(engine).store_experiment_fixture(snapshot)
        epoch = await repository.acquire_writer_epoch(scope, "stage2-verifier")
        sizing_policy = policy(instrument)
        await repository.register_policy(scope, epoch, sizing_policy)
        boot = await repository.reconcile_account(reconcile(scope, epoch, 0,
            snapshot, sizing_policy), bootstrap=True)
        assert boot["status"] == "clean", boot
        stop_body = json.dumps({"scope": scope.model_dump(), "stopped": False},
            sort_keys=True, separators=(",", ":")).encode()
        stop_hash = hashlib.sha256(b"moeazi-finance-command-v1:set-stop\n"
            + stop_body).hexdigest()
        opened = await repository.set_account_stop(scope, epoch, boot["revision"],
            stopped=False, idempotency_key="open", request_hash=stop_hash)
        revision = opened["revision"]
        request = SizingRequest(action="spot_buy",
            instrument_version_id=instrument.instrument_version_id,
            desired_quantity_units="100000000",
            quantity_asset_unit_id=instrument.base_asset_unit_id,
            quantity_registry_hash=BASE_REGISTRY,
            quote_asset_unit_id=instrument.quote_asset_unit_id,
            quote_registry_hash=QUOTE_REGISTRY, location_id="wallet",
            quote_per_quantity_numerator="25001",
            quote_per_quantity_denominator="100",
            price_snapshot_hash=evidence.snapshot_hash,
            account_snapshot_hash=snapshot.snapshot_hash,
            existing_gross_notional_units="0",
            existing_directional_notional_units="0")
        with pytest.raises(FinanceError, match="caller sizing values differ"):
            await repository.prepare_experiment_sizing_receipt(scope, epoch,
                revision, sizing_policy.policy_version, request.model_copy(update={
                    "quote_per_quantity_numerator": "1"}))
        with pytest.raises(FinanceError):
            await repository.prepare_experiment_sizing_receipt(scope, epoch,
                revision, sizing_policy.policy_version, request.model_copy(update={
                    "existing_gross_notional_units": "1"}))
        receipt = await repository.prepare_experiment_sizing_receipt(scope, epoch,
            revision, sizing_policy.policy_version, request)
        assert receipt["notional_units"] == "25001000000"
        assert receipt["account_revision"] == str(revision)
        assert receipt["authorityClass"] == "experiment_only"
    finally:
        await engine.dispose()
