"""Q2 real PostgreSQL proof; root applies SQL056 to the named disposable DB."""
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.account_observation_storage import (
    AccountObservationRepository, account_snapshot_hash,
)
from moeazi_agent.finance_contracts import FinanceScope
from moeazi_agent.finance_observation_contracts import (
    AccountObservationSnapshotRef, ObservedBalance, ObservedPosition,
)
from moeazi_agent.native_observations import hyperliquid_book_observation
from moeazi_agent.observation_contracts import InstrumentVersion, MarketObservation
from moeazi_agent.observation_replay import replay_observations
from moeazi_agent.observation_storage import ObservationConflict, ObservationRepository


HASH = "a" * 64


def guarded_dsn():
    raw = os.getenv("MOEAZI_TEST_POSTGRES_DSN")
    if not raw:
        pytest.skip("set explicit MOEAZI_TEST_POSTGRES_DSN for disposable local Q2 DB")
    url = make_url(raw)
    if url.database != "moeazi_q3_20260930" or url.host not in {"localhost", "127.0.0.1", "::1"} \
            or url.port != 15432:
        pytest.fail("Q2 DB harness is restricted to the named disposable loopback database")
    if url.drivername != "postgresql+asyncpg":
        pytest.fail("Q2 DB harness requires the local asyncpg PostgreSQL driver")
    return raw


def native_instrument(identity, effective_at):
    return InstrumentVersion(instrument_version_id=f"q2:BTC:{identity}",
        venue_id="hyperliquid", native_instrument_id="BTC", product_kind="perpetual",
        base_asset_unit_id="BTC:8", quote_asset_unit_id="USDC:6",
        settlement_asset_unit_id="USDC:6", base_decimals=8,
        quote_decimals=6, settlement_decimals=6, size_decimals=8,
        contract_multiplier="1", price_rule="hyperliquid_perp_significant_figures_v1",
        lot_step="0.00000001", margin_model="cross_fixture",
        funding_model="fixture", effective_at=effective_at,
        registry_hash=hashlib.sha256(identity.encode()).hexdigest())


@pytest.mark.asyncio
async def test_native_bytes_are_reparsed_and_observation_rows_are_insert_only():
    engine = create_async_engine(guarded_dsn())
    identity = uuid4().hex
    received = datetime.now(timezone.utc).replace(microsecond=0)
    instrument = native_instrument(identity, received - timedelta(minutes=1))
    payload = json.dumps({"coin": "BTC",
        "time": int((received - timedelta(seconds=2)).timestamp() * 1000),
        "levels": [[{"px": "25000", "sz": "1"}], [{"px": "25001", "sz": "1"}]]},
        separators=(",", ":")).encode()
    observation = hyperliquid_book_observation(payload, instrument,
        received_at=received, source_rights_ref="internal_qualification_only")
    repository = ObservationRepository(engine)
    raw_ref = f"local:stage2:{identity}"
    try:
        first = await repository.register_instrument(instrument)
        assert first.instrument_version_id == instrument.instrument_version_id
        assert await repository.register_instrument(instrument) == first
        with pytest.raises(ObservationConflict):
            await repository.register_instrument(instrument.model_copy(
                update={"registry_hash": "b" * 64}))
        event_hash = await repository.ingest_market_observation(instrument, observation,
            raw_payload_bytes=payload, raw_payload_ref=raw_ref,
            policy_version="q2_internal_research_v1")
        assert event_hash == await repository.ingest_market_observation(instrument, observation,
            raw_payload_bytes=payload, raw_payload_ref=raw_ref,
            policy_version="q2_internal_research_v1")
        forged_book = MarketObservation.model_validate(observation.model_dump() | {
            "bids": [{"price_quote_per_base": "24999", "size_base": "1"}]})
        with pytest.raises(ObservationConflict, match="Normalized"):
            await repository.ingest_market_observation(instrument, forged_book,
                raw_payload_bytes=payload, raw_payload_ref=raw_ref,
                policy_version="q2_internal_research_v1")
        forged_time = MarketObservation.model_validate(observation.model_dump() | {
            "event_at": observation.event_at - timedelta(seconds=1)})
        with pytest.raises(ObservationConflict, match="Normalized"):
            await repository.ingest_market_observation(instrument, forged_time,
                raw_payload_bytes=payload, raw_payload_ref=raw_ref,
                policy_version="q2_internal_research_v1")
        with pytest.raises(ObservationConflict):
            await repository.ingest_market_observation(instrument, observation,
                raw_payload_bytes=payload, raw_payload_ref=f"local:changed:{identity}",
                policy_version="q2_internal_research_v1")
        snapshot = replay_observations([instrument], [observation], received, 60_000)
        assert snapshot.accepted_observation_hashes == (event_hash,)
        assert await repository.store_evidence_snapshot(snapshot) == snapshot.snapshot_hash
        assert await repository.store_evidence_snapshot(snapshot) == snapshot.snapshot_hash
        for statement in [
            "UPDATE observation_market_events SET source_rights_ref='forged' WHERE observation_hash=:hash",
            "DELETE FROM observation_market_events WHERE observation_hash=:hash",
        ]:
            with pytest.raises(DBAPIError, match="immutable"):
                async with engine.begin() as conn:
                    await conn.execute(text(statement), {"hash": event_hash})
        async with engine.connect() as conn:
            row = (await conn.execute(text("SELECT raw_payload_hash,source_rights_ref FROM "
                "observation_market_events WHERE observation_hash=:hash"),
                {"hash": event_hash})).one()
        assert row.raw_payload_hash == hashlib.sha256(payload).hexdigest()
        assert row.source_rights_ref == "internal_qualification_only"
    finally:
        await engine.dispose()


def account_fixture(identity):
    plus_three = timezone(timedelta(hours=3))
    base = datetime(2026, 9, 30, 15, tzinfo=plus_three)
    body = dict(scope=FinanceScope(environment="experiment", scope_id=f"q2-{identity}",
        strategy_account_id=f"acct-{identity}"), snapshot_hash="0" * 64,
        source_account_id=f"fixture:{identity}", origin="recorded_fixture",
        status="accepted", event_at=base, available_at=base + timedelta(minutes=1),
        received_at=base + timedelta(minutes=2), cutoff_at=base + timedelta(minutes=5),
        finality="admitted_final", finality_at=base + timedelta(minutes=3),
        has_gap=False, has_reorg=False, balances_complete=True,
        positions_complete=True, rights_ref="internal_qualification_only",
        source_event_hash=HASH, source_payload_hash="b" * 64,
        registry_hash="c" * 64, policy_version="fixture-policy-v1",
        observed_balances=(ObservedBalance(asset_unit_id="USDC:6", location_id="wallet",
            book="wallet", units="9007199254740993", registry_hash="d" * 64),),
        observed_positions=(ObservedPosition(instrument_version_id="perp:BTC:v1",
            location_id="venue", instrument_registry_hash="e" * 64,
            contract_size_unit_id="contract:BTC:100", signed_contracts="-2",
            collateral_asset_unit_id="USDC:6", margin_units="50000000",
            funding_event_ids=("funding-1", "funding-2"),
            fee_event_ids=("fee-1",)),))
    provisional = AccountObservationSnapshotRef(**body)
    return AccountObservationSnapshotRef.model_validate(
        provisional.model_dump() | {"snapshot_hash": account_snapshot_hash(provisional)})


@pytest.mark.asyncio
async def test_account_fixture_hash_utc_and_nested_position_roundtrip_is_immutable():
    engine = create_async_engine(guarded_dsn())
    repository = AccountObservationRepository(engine)
    fixture = account_fixture(uuid4().hex)
    try:
        assert fixture.event_at.utcoffset() == timedelta(0)
        assert await repository.store_experiment_fixture(fixture) == fixture.snapshot_hash
        assert await repository.store_experiment_fixture(fixture) == fixture.snapshot_hash
        loaded = await repository.load_by_hash(fixture.snapshot_hash)
        assert loaded == fixture
        assert loaded.observed_positions[0].funding_event_ids == ("funding-1", "funding-2")
        assert loaded.observed_balances[0].units == "9007199254740993"
        with pytest.raises(ValueError, match="Only internally scoped"):
            await repository.store_experiment_fixture(fixture.model_copy(
                update={"scope": FinanceScope(environment="live", scope_id="live",
                    strategy_account_id=fixture.scope.strategy_account_id)}))
        with pytest.raises(DBAPIError, match="immutable"):
            async with engine.begin() as conn:
                await conn.execute(text("DELETE FROM observation_account_snapshots "
                    "WHERE snapshot_hash=:hash"), {"hash": fixture.snapshot_hash})
    finally:
        await engine.dispose()
