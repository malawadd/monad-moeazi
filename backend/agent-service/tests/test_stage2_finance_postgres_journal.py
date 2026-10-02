"""Q3 journal and outbox behavior against root-managed disposable PostgreSQL."""
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
    FinanceError, FinanceScope, JournalCommand, JournalPosting, ReconcileCommand,
    semantic_request_hash, source_event_digest,
)
from moeazi_agent.finance_observation_contracts import (
    AccountObservationSnapshotRef, ObservedBalance,
)
from moeazi_agent.finance_policy import SizingPolicy
from moeazi_agent.finance_repository import FinanceRepository


HASH = "a" * 64
REGISTRY = "b" * 64


def guarded_dsn():
    raw = os.getenv("MOEAZI_TEST_POSTGRES_DSN")
    if not raw:
        pytest.skip("SQL055 requires explicit disposable local PostgreSQL DSN")
    url = make_url(raw)
    if (url.drivername, url.host, url.port, url.database) != (
            "postgresql+asyncpg", "127.0.0.1", 15432, "moeazi_q3_20260930"):
        pytest.fail("Q3 harness is restricted to root's disposable loopback database")
    return raw


def policy():
    body = dict(policy_version="q3-journal-fixture", instrument_version_id="BTC/USDC:v1",
        max_quantity_units="100", min_quantity_units="1", quantity_step_units="1",
        max_gross_notional_units="1000000", max_directional_notional_units="1000000",
        initial_margin_bps=1000, fee_ceiling_units="0", exit_buffer_units="0",
        max_observation_age_seconds=3600, max_reservation_seconds=60,
        approved_live=False)
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"),
        ensure_ascii=False).encode()
    digest = hashlib.sha256(b"moeazi-finance-policy-v1\n" + canonical).hexdigest()
    return SizingPolicy(**body, policy_hash=digest)


def observation(scope, identity, units, now):
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
        registry_hash=REGISTRY, policy_version="q3-journal-fixture",
        observed_balances=(ObservedBalance(asset_unit_id="USDC:6",
            location_id="wallet", book="wallet", units=str(units),
            registry_hash=REGISTRY),), observed_positions=())
    return AccountObservationSnapshotRef.model_validate(provisional.model_dump() | {
        "snapshot_hash": account_snapshot_hash(provisional)})


def reconcile(scope, epoch, revision, snapshot, sizing_policy, key):
    body = dict(scope=scope, expected_revision=revision, writer_epoch=epoch,
        idempotency_key=key, request_hash=HASH, snapshot_hash=snapshot.snapshot_hash,
        policy_version=sizing_policy.policy_version, policy_hash=sizing_policy.policy_hash)
    provisional = ReconcileCommand.model_construct(**body)
    return ReconcileCommand.model_validate(body | {
        "request_hash": semantic_request_hash("reconcile", provisional)})


def posting(book, location, units):
    return JournalPosting(asset_unit_id="USDC:6", registry_hash=REGISTRY,
        location_id=location, book=book, units=str(units))


def journal(scope, epoch, revision, identity, postings, *, source_revision="1",
            source_event_id="fill-1", source_payload_hash=HASH, key="fill-1",
            observed_at=None, kind="fill"):
    body = dict(scope=scope, expected_revision=revision, writer_epoch=epoch,
        idempotency_key=key, request_hash=HASH, source_owner="venue",
        source_stream="fills", source_event_id=source_event_id,
        source_revision=source_revision, source_event_hash=HASH,
        source_payload_hash=source_payload_hash, kind=kind,
        observed_at=observed_at or datetime(2026, 9, 30, tzinfo=timezone.utc),
        postings=postings, reverses_transaction_id=None)
    provisional = JournalCommand.model_construct(**body)
    body["source_event_hash"] = source_event_digest(provisional)
    provisional = JournalCommand.model_construct(**body)
    body["request_hash"] = semantic_request_hash("journal", provisional)
    return JournalCommand.model_validate(body)


async def setup_account(engine, identity, units=100):
    repo = FinanceRepository(engine)
    scope = FinanceScope(environment="experiment", scope_id=f"q3-{identity}",
        strategy_account_id=f"acct-{identity}")
    epoch = await repo.acquire_writer_epoch(scope, "stage2-verifier")
    async with engine.connect() as conn:
        now = (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()
    snapshot = observation(scope, identity, units, now)
    await AccountObservationRepository(engine).store_experiment_fixture(snapshot)
    sizing_policy = policy()
    await repo.register_policy(scope, epoch, sizing_policy)
    boot = await repo.reconcile_account(reconcile(scope, epoch, 0, snapshot,
        sizing_policy, "bootstrap"), bootstrap=True)
    assert boot["status"] == "clean", boot
    return repo, scope, epoch, snapshot, sizing_policy, boot["revision"]


@pytest.mark.asyncio
async def test_live_journal_is_denied_before_any_database_access():
    class NoDatabase:
        def begin(self):
            raise AssertionError("live journal touched the financial database")

    scope = FinanceScope(environment="live", scope_id="live",
        strategy_account_id="acct-live")
    rows = (posting("wallet", "wallet", 1),
            posting("external", "external", -1))
    with pytest.raises(FinanceError, match="verified native source adapter"):
        await FinanceRepository(NoDatabase()).apply_journal_event(
            journal(scope, 1, 0, "live", rows))


@pytest.mark.asyncio
async def test_same_economic_fill_new_transport_revision_never_double_posts():
    engine = create_async_engine(guarded_dsn())
    identity = uuid4().hex
    try:
        repo, scope, epoch, _, _, revision = await setup_account(engine, identity)
        rows = (posting("wallet", "wallet", 10),
                posting("external", "external", -10))
        first = await repo.apply_journal_event(journal(scope, epoch, revision,
            identity, rows))
        assert first["status"] == "applied"
        repeat = await repo.apply_journal_event(journal(scope, epoch,
            first["revision"], identity, rows, source_revision="2", key="retry-new-transport"))
        assert repeat["transactionId"] == first["transactionId"]
        assert repeat["revision"] == first["revision"]
        changed = (posting("wallet", "wallet", 11),
                   posting("external", "external", -11))
        with pytest.raises(FinanceError, match="source event conflicts"):
            await repo.apply_journal_event(journal(scope, epoch, first["revision"],
                identity, changed, source_revision="3", key="changed-economics"))
        forged = journal(scope, epoch, first["revision"], identity, rows)
        with pytest.raises(Exception):
            await repo.apply_journal_event(forged.model_copy(update={
                "postings": changed}))
        async with engine.connect() as conn:
            stored = (await conn.execute(text("""
                SELECT a.revision,b.units,(SELECT count(*) FROM finance_journal_transactions t
                  WHERE t.scope_id=a.scope_id) AS transactions,
                  (SELECT count(*) FROM finance_outbox o WHERE o.scope_id=a.scope_id)
                    AS outbox_events
                FROM finance_accounts a JOIN finance_balances b USING
                  (environment,scope_id,strategy_account_id)
                WHERE a.scope_id=:scope AND b.location_id='wallet'
            """), {"scope": scope.scope_id})).one()
        assert stored.revision == first["revision"]
        assert int(stored.units) == 110
        assert stored.transactions == 2  # opening and one fill
        assert stored.outbox_events == 2
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_out_of_order_negative_event_is_pending_then_converges_after_replay():
    engine = create_async_engine(guarded_dsn())
    identity = uuid4().hex
    try:
        repo, scope, epoch, _, _, revision = await setup_account(engine, identity, 0)
        sell = (posting("wallet", "wallet", -10),
                posting("external", "external", 10))
        first = await repo.apply_journal_event(journal(scope, epoch, revision,
            identity, sell, source_event_id="sell", key="sell"))
        assert first["status"] == "pending"
        async with engine.connect() as conn:
            state = (await conn.execute(text("SELECT reconciliation_state FROM "
                "finance_accounts WHERE scope_id=:scope"), {"scope": scope.scope_id})).scalar_one()
        assert state == "quarantined"
        buy = (posting("wallet", "wallet", 10),
               posting("external", "external", -10))
        precursor = await repo.apply_journal_event(journal(scope, epoch,
            first["revision"], identity, buy, source_event_id="buy", key="buy"))
        assert precursor["status"] == "applied"
        retried = await repo.apply_journal_event(journal(scope, epoch,
            precursor["revision"], identity, sell, source_event_id="sell", key="sell"))
        assert retried["status"] == "applied"
        async with engine.connect() as conn:
            balance = (await conn.execute(text("SELECT units FROM finance_balances "
                "WHERE scope_id=:scope AND location_id='wallet'"),
                {"scope": scope.scope_id})).scalar_one()
            pending = (await conn.execute(text("SELECT count(*) FROM finance_pending_events "
                "WHERE scope_id=:scope"), {"scope": scope.scope_id})).scalar_one()
        assert int(balance) == 0
        assert pending == 0
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_colliding_capacity_alias_does_not_poison_opening_and_can_be_corrected():
    engine = create_async_engine(guarded_dsn())
    identity = uuid4().hex
    scope = FinanceScope(environment="experiment", scope_id=f"q3-{identity}",
        strategy_account_id=f"acct-{identity}")
    repo = FinanceRepository(engine)
    try:
        epoch = await repo.acquire_writer_epoch(scope, "stage2-verifier")
        async with engine.connect() as conn:
            now = (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()
        base = observation(scope, identity, 10, now)
        first = ObservedBalance(asset_unit_id="a:b", location_id="c",
            book="wallet", units="10", registry_hash=REGISTRY)
        second = ObservedBalance(asset_unit_id="a", location_id="b:c",
            book="wallet", units="10", registry_hash=REGISTRY)
        provisional = base.model_copy(update={"snapshot_hash": "0" * 64,
            "observed_balances": (first, second)})
        bad = AccountObservationSnapshotRef.model_validate(provisional.model_dump() | {
            "snapshot_hash": account_snapshot_hash(provisional)})
        await AccountObservationRepository(engine).store_experiment_fixture(bad)
        sizing_policy = policy()
        await repo.register_policy(scope, epoch, sizing_policy)
        rejected = await repo.reconcile_account(reconcile(scope, epoch, 0,
            bad, sizing_policy, "bootstrap-bad"), bootstrap=True)
        assert rejected["status"] == "quarantined"
        assert rejected["reason"] == "capacity_identity_collision"
        async with engine.connect() as conn:
            counts = (await conn.execute(text("""
                SELECT (SELECT count(*) FROM finance_source_events
                    WHERE scope_id=:scope) AS sources,
                  (SELECT count(*) FROM finance_balances
                    WHERE scope_id=:scope) AS balances,
                  (SELECT source_account_id FROM finance_accounts
                    WHERE scope_id=:scope) AS source_account
            """), {"scope": scope.scope_id})).one()
        assert counts.sources == counts.balances == 0
        assert counts.source_account is None
        corrected = bad.model_copy(update={"snapshot_hash": "0" * 64,
            "source_event_hash": hashlib.sha256(f"corrected:{identity}".encode()).hexdigest(),
            "source_payload_hash": hashlib.sha256(f"corrected-payload:{identity}".encode()).hexdigest(),
            "observed_balances": (first, second.model_copy(update={"location_id": "other"}))})
        corrected = AccountObservationSnapshotRef.model_validate(corrected.model_dump() | {
            "snapshot_hash": account_snapshot_hash(corrected)})
        await AccountObservationRepository(engine).store_experiment_fixture(corrected)
        accepted = await repo.reconcile_account(reconcile(scope, epoch,
            rejected["revision"], corrected, sizing_policy,
            "bootstrap-corrected"), bootstrap=True)
        assert accepted["status"] == "clean", accepted
        async with engine.connect() as conn:
            count = (await conn.execute(text("SELECT count(*) FROM finance_balances "
                "WHERE scope_id=:scope AND book='wallet'"),
                {"scope": scope.scope_id})).scalar_one()
        assert count == 2
    finally:
        await engine.dispose()
