"""Q3 proof-backed full-fill recovery on root's disposable PostgreSQL only."""
import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.account_observation_storage import (
    AccountObservationRepository, account_snapshot_hash,
)
from moeazi_agent.finance_contracts import (
    FinanceError, FinanceScope, JournalPosting, ReconcileCommand,
    semantic_request_hash,
)
from moeazi_agent.finance_observation_contracts import (
    AccountObservationSnapshotRef, ObservedBalance,
)
from moeazi_agent.finance_repository import FinanceRepository
from test_stage2_finance_postgres_journal import journal
from test_stage2_finance_postgres_reservations import (
    held_rows, request, reserve_command,
)
from test_stage2_finance_postgres_sizing import guarded_dsn, setup_spot_account


HASH = "a" * 64
BASE_REGISTRY = "b" * 64
QUOTE_REGISTRY = "c" * 64


def millis(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z")


async def db_now(engine):
    async with engine.connect() as conn:
        return (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()


def posting(asset, registry, location, book, units):
    return JournalPosting(asset_unit_id=asset, registry_hash=registry,
        location_id=location, book=book, units=str(units))


def post_fill_snapshot(initial, instrument, base_units, quote_units, at, identity):
    balances = (ObservedBalance(asset_unit_id=instrument.base_asset_unit_id,
        location_id="wallet", book="wallet", units=str(base_units),
        registry_hash=BASE_REGISTRY),
        ObservedBalance(asset_unit_id=instrument.quote_asset_unit_id,
        location_id="wallet", book="wallet", units=str(quote_units),
        registry_hash=QUOTE_REGISTRY))
    provisional = initial.model_copy(update={"snapshot_hash": "0" * 64,
        "source_event_hash": hashlib.sha256(f"after:{identity}".encode()).hexdigest(),
        "source_payload_hash": hashlib.sha256(f"after-payload:{identity}".encode()).hexdigest(),
        "event_at": at, "available_at": at, "received_at": at,
        "cutoff_at": at, "finality_at": at,
        "observed_balances": balances})
    return AccountObservationSnapshotRef.model_validate(provisional.model_dump() | {
        "snapshot_hash": account_snapshot_hash(provisional)})


def reconcile(scope, epoch, revision, snapshot, policy, key):
    body = dict(scope=scope, expected_revision=revision, writer_epoch=epoch,
        idempotency_key=key, request_hash=HASH,
        snapshot_hash=snapshot.snapshot_hash,
        policy_version=policy.policy_version, policy_hash=policy.policy_hash)
    return ReconcileCommand.model_validate(body | {
        "request_hash": semantic_request_hash("reconcile",
            ReconcileCommand.model_construct(**body))})


def proof_bytes(scope, reservation_id, attempt_id, client_id, snapshot_hash,
                event_time, *, outcome, source_event_hash=None, transaction_id=None,
                source_event_id="resolution-1"):
    body = dict(schemaVersion=1, environment="experiment", scopeId=scope.scope_id,
        strategyAccountId=scope.strategy_account_id,
        reservationId=reservation_id, attemptId=attempt_id, clientId=client_id,
        normalizedPayloadHash=HASH, nativeId="simulated-native-fill"
            if outcome == "filled" else None,
        sourceOwner="experiment_fixture", sourceStream="resolution",
        sourceEventId=source_event_id, sourceRevision="1",
        sourceEventHash=source_event_hash, eventAt=millis(event_time),
        finalityAt=millis(event_time), outcome=outcome,
        rightsRef="internal_qualification_only",
        accountSnapshotHash=snapshot_hash,
        linkedTransactionId=transaction_id)
    return json.dumps(body, sort_keys=True, separators=(",", ":")).encode()


@pytest.mark.asyncio
async def test_live_resolution_refuses_before_database_access():
    class NoDatabase:
        def begin(self):
            raise AssertionError("live resolution touched database")

    scope = FinanceScope(environment="live", scope_id="live",
        strategy_account_id="acct-live")
    repository = FinanceRepository(NoDatabase())
    with pytest.raises(FinanceError, match="experimental"):
        await repository.store_experiment_resolution_fixture(scope, b"{}", 1)
    with pytest.raises(FinanceError, match="experiment-only"):
        await repository.resolve_reservation(scope, "reservation", HASH, 1, 0,
            "resolution")


@pytest.mark.asyncio
@pytest.mark.parametrize("extra_fee", [0, 20])
async def test_exact_spot_fill_settles_only_target_and_recovers_remaining_capacity(extra_fee):
    engine = create_async_engine(guarded_dsn())
    identity = uuid4().hex
    try:
        repo, scope, epoch, instrument, snapshot, evidence, policy, opened = \
            await setup_spot_account(engine, identity)
        revision = opened["revision"]
        trade = await repo.prepare_experiment_sizing_receipt(scope, epoch,
            revision, policy.policy_version,
            request(instrument, snapshot, evidence, 70, 0))
        target = await repo.reserve_intent(await reserve_command(engine, scope,
            epoch, opened, policy, snapshot, trade, purpose="trade",
            team="team-a", intent="buy-70", revision=revision))
        withdrawal = await repo.prepare_experiment_withdrawal_receipt(scope,
            epoch, target["revision"], policy.policy_version,
            instrument.quote_asset_unit_id, "wallet", "20")
        other = await repo.reserve_intent(await reserve_command(engine, scope,
            epoch, opened, policy, snapshot, withdrawal, purpose="withdrawal",
            team="owner", intent="withdraw-20", revision=target["revision"]))
        submitted = await repo.mark_submission_started(scope,
            target["reservationId"], "client-buy-70", HASH, epoch,
            opened["authorityEpoch"], other["revision"], "submit-70")
        observed_at = await db_now(engine)
        base, quote = instrument.base_asset_unit_id, instrument.quote_asset_unit_id
        legs = (posting(base, BASE_REGISTRY, "wallet", "wallet", 70),
                posting(base, BASE_REGISTRY, "external", "external", -70),
                posting(quote, QUOTE_REGISTRY, "wallet", "wallet", -70),
                posting(quote, QUOTE_REGISTRY, "external", "external", 70))
        fill_command = journal(scope, epoch, submitted["revision"], identity,
            legs, source_event_id="fill-buy-70", key="journal-buy-70",
            observed_at=observed_at)
        filled = await repo.apply_journal_event(fill_command)
        assert filled["status"] == "applied"
        latest_revision = filled["revision"]
        if extra_fee:
            fee = await repo.apply_journal_event(journal(scope, epoch,
                latest_revision, identity,
                (posting(quote, QUOTE_REGISTRY, "wallet", "wallet", -extra_fee),
                 posting(quote, QUOTE_REGISTRY, "fees", "fees", extra_fee)),
                source_event_id="unrelated-fee", key="fee-20",
                observed_at=await db_now(engine), kind="fee"))
            latest_revision = fee["revision"]
        later = await db_now(engine)
        final_snapshot = post_fill_snapshot(snapshot, instrument, 70,
            30 - extra_fee,
            later, identity)
        await AccountObservationRepository(engine).store_experiment_fixture(
            final_snapshot)
        checkpoint = await repo.reconcile_account(reconcile(scope, epoch,
            latest_revision, final_snapshot, policy, "post-fill"))
        assert checkpoint["status"] == "quarantined"
        assert checkpoint["reason"] == "reserved_capacity_exceeds_observed"
        raw = proof_bytes(scope, target["reservationId"], submitted["attemptId"],
            "client-buy-70", final_snapshot.snapshot_hash, observed_at,
            outcome="filled", source_event_hash=fill_command.source_event_hash,
            transaction_id=filled["transactionId"])
        saved = await repo.store_experiment_resolution_fixture(scope, raw, epoch)
        assert saved == await repo.store_experiment_resolution_fixture(scope, raw,
            epoch)
        with pytest.raises(FinanceError, match="proof"):
            await repo.resolve_reservation(scope, target["reservationId"],
                "f" * 64, epoch, checkpoint["revision"], "forged-proof")
        if extra_fee:
            with pytest.raises(FinanceError, match="other retained holds exceed"):
                await repo.resolve_reservation(scope, target["reservationId"],
                    saved["proofHash"], epoch, checkpoint["revision"],
                    "cannot-free-other-hold")
            rows, _ = await held_rows(engine, scope)
            assert {(row["intent_id"], row["status"]) for row in rows} == {
                ("buy-70", "submitted"), ("withdraw-20", "reserved")}
            return
        resolved = await repo.resolve_reservation(scope, target["reservationId"],
            saved["proofHash"], epoch, checkpoint["revision"], "resolve-70")
        assert resolved["status"] == "settled"
        restarted = FinanceRepository(engine)
        assert await restarted.resolve_reservation(scope,
            target["reservationId"], saved["proofHash"], epoch,
            checkpoint["revision"], "resolve-70") == resolved
        with pytest.raises(FinanceError, match="idempotency key conflicts"):
            await restarted.resolve_reservation(scope, target["reservationId"],
                "f" * 64, epoch, resolved["revision"], "resolve-70")
        rows, outbox = await held_rows(engine, scope)
        assert {(row["intent_id"], row["status"], int(row["units"]))
                for row in rows} == {("buy-70", "settled", 70),
                                     ("withdraw-20", "reserved", 20)}
        async with engine.connect() as conn:
            state = (await conn.execute(text("""
                SELECT a.reconciliation_state,a.observation_snapshot_hash,
                  c.limit_units,(SELECT units FROM finance_balances b
                    WHERE b.scope_id=a.scope_id AND b.asset_unit_id=:asset
                      AND b.book='wallet') AS wallet_units,
                  (SELECT payload FROM finance_outbox o WHERE o.scope_id=a.scope_id
                    ORDER BY account_revision DESC LIMIT 1) AS latest
                FROM finance_accounts a JOIN finance_capacity c USING
                  (environment,scope_id,strategy_account_id)
                WHERE a.scope_id=:scope AND c.asset_unit_id=:asset
            """), {"scope": scope.scope_id,
                   "asset": quote})).mappings().one()
        assert state["reconciliation_state"] == "clean"
        assert state["observation_snapshot_hash"] == final_snapshot.snapshot_hash
        assert int(state["wallet_units"]) == int(state["limit_units"]) == 30
        assert state["latest"]["capacity"][1]["availableUnits"] == "10"
        assert outbox == 8  # opening, admit, two holds, submit, fill, reconcile, resolve
    finally:
        await engine.dispose()
