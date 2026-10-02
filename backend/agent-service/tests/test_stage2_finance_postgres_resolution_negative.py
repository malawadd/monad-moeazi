"""Q3 resolution proofs fail closed on identity, timing, and absent journal evidence."""
import asyncio
import json
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.account_observation_storage import AccountObservationRepository
from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.finance_repository import FinanceRepository
from test_stage2_finance_postgres_journal import journal, posting
from test_stage2_finance_postgres_reservations import (
    held_rows, request, reserve_command,
)
from test_stage2_finance_postgres_resolution import (
    db_now, post_fill_snapshot, posting as asset_posting, proof_bytes, reconcile,
)
from test_stage2_finance_postgres_sizing import guarded_dsn, setup_spot_account


HASH = "a" * 64


async def submitted_withdrawal(engine, identity):
    repo, scope, epoch, instrument, snapshot, _, policy, opened = \
        await setup_spot_account(engine, identity)
    receipt = await repo.prepare_experiment_withdrawal_receipt(scope,
        epoch, opened["revision"], policy.policy_version,
        instrument.quote_asset_unit_id, "wallet", "70")
    command = await reserve_command(engine, scope, epoch, opened,
        policy, snapshot, receipt, purpose="withdrawal", team="owner",
        intent="withdraw-70", revision=opened["revision"])
    reserved = await repo.reserve_intent(command)
    started = await repo.mark_submission_started(scope,
        reserved["reservationId"], "client-withdraw-70", HASH, epoch,
        opened["authorityEpoch"], reserved["revision"], "submit-70")
    await asyncio.sleep(0.01)
    return repo, scope, epoch, instrument, snapshot, policy, reserved, started


@pytest.mark.asyncio
async def test_no_fill_requires_matching_attempt_and_later_complete_snapshot():
    engine = create_async_engine(guarded_dsn())
    identity = uuid4().hex
    try:
        repo, scope, epoch, instrument, initial, _, reserved, started = \
            await submitted_withdrawal(engine, identity)
        event_time = await db_now(engine)
        later = post_fill_snapshot(initial, instrument, 0, 100,
            await db_now(engine), identity)
        await AccountObservationRepository(engine).store_experiment_fixture(later)
        raw = proof_bytes(scope, reserved["reservationId"], started["attemptId"],
            "client-withdraw-70", later.snapshot_hash, event_time,
            outcome="rejected_no_fill", source_event_id="no-fill")
        forged_attempt = json.loads(raw)
        forged_attempt["attemptId"] = "someone-elses-attempt"
        with pytest.raises(FinanceError, match="submission attempt"):
            await repo.store_experiment_resolution_fixture(scope,
                json.dumps(forged_attempt).encode(), epoch)
        saved = await repo.store_experiment_resolution_fixture(scope, raw, epoch)
        changed = json.loads(raw)
        changed["sourceRevision"] = "2"
        changed["clientId"] = "changed-client"
        with pytest.raises(FinanceError, match="different final proof"):
            await repo.store_experiment_resolution_fixture(scope,
                json.dumps(changed).encode(), epoch)
        with pytest.raises(FinanceError, match="resolution source event conflicts"):
            await repo.store_experiment_resolution_fixture(scope,
                json.dumps({**json.loads(raw), "nativeId": "changed"}).encode(), epoch)
        released = await repo.resolve_reservation(scope,
            reserved["reservationId"], saved["proofHash"], epoch,
            started["revision"], "valid-no-fill")
        assert released["status"] == "released"
        rows, _ = await held_rows(engine, scope)
        assert [(row["status"], int(row["units"])) for row in rows] == [
            ("released", 70)]
        assert await FinanceRepository(engine).resolve_reservation(scope,
            reserved["reservationId"], saved["proofHash"], epoch,
            started["revision"], "valid-no-fill") == released
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_no_fill_cannot_disprove_any_later_journal_activity():
    engine = create_async_engine(guarded_dsn())
    identity = uuid4().hex
    try:
        repo, scope, epoch, instrument, initial, _, reserved, started = \
            await submitted_withdrawal(engine, identity)
        event_time = await db_now(engine)
        journaled = await repo.apply_journal_event(journal(scope, epoch,
            started["revision"], identity,
            (posting("wallet", "wallet", 1),
             posting("external", "external", -1)),
            source_event_id="unrelated-deposit", key="deposit",
            observed_at=event_time))
        assert journaled["status"] == "applied"
        later = post_fill_snapshot(initial, instrument, 0, 101,
            await db_now(engine), identity)
        await AccountObservationRepository(engine).store_experiment_fixture(later)
        raw = proof_bytes(scope, reserved["reservationId"], started["attemptId"],
            "client-withdraw-70", later.snapshot_hash, event_time,
            outcome="rejected_no_fill", source_event_id="unsafe-no-fill")
        saved = await repo.store_experiment_resolution_fixture(scope, raw, epoch)
        with pytest.raises(FinanceError, match="cannot exclude later journal activity"):
            await repo.resolve_reservation(scope, reserved["reservationId"],
                saved["proofHash"], epoch, journaled["revision"], "unsafe-no-fill")
        rows, _ = await held_rows(engine, scope)
        assert rows[0]["status"] == "submitted"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("case,reason", [
    ("earlier_snapshot", "later complete account evidence"),
    ("opening_is_not_fill", "matching journal event"),
])
async def test_resolution_rejects_earlier_snapshot_or_nonfill_journal(case, reason):
    engine = create_async_engine(guarded_dsn())
    identity = uuid4().hex
    try:
        repo, scope, epoch, instrument, initial, _, reserved, started = \
            await submitted_withdrawal(engine, identity)
        event_time = await db_now(engine)
        later = post_fill_snapshot(initial, instrument, 0, 100,
            await db_now(engine), identity)
        await AccountObservationRepository(engine).store_experiment_fixture(later)
        if case == "earlier_snapshot":
            raw = proof_bytes(scope, reserved["reservationId"],
                started["attemptId"], "client-withdraw-70",
                initial.snapshot_hash, event_time,
                outcome="rejected_no_fill", source_event_id=case)
        else:
            async with engine.connect() as conn:
                opening = (await conn.execute(text("""
                    SELECT t.transaction_id,t.source_event_hash FROM
                      finance_journal_transactions t
                    JOIN finance_source_events e USING
                      (environment,scope_id,strategy_account_id,source_event_hash)
                    WHERE t.scope_id=:scope AND e.event_kind='opening'
                """), {"scope": scope.scope_id})).one()
            raw = proof_bytes(scope, reserved["reservationId"],
                started["attemptId"], "client-withdraw-70",
                later.snapshot_hash, event_time,
                outcome="filled", source_event_hash=opening.source_event_hash,
                transaction_id=opening.transaction_id, source_event_id=case)
        saved = await repo.store_experiment_resolution_fixture(scope, raw, epoch)
        with pytest.raises(FinanceError, match=reason):
            await repo.resolve_reservation(scope, reserved["reservationId"],
                saved["proofHash"], epoch, started["revision"], case)
        rows, _ = await held_rows(engine, scope)
        assert rows[0]["status"] == "submitted"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_partial_spot_fill_cannot_release_full_trade_reservation():
    engine = create_async_engine(guarded_dsn())
    identity = uuid4().hex
    try:
        repo, scope, epoch, instrument, initial, evidence, policy, opened = \
            await setup_spot_account(engine, identity)
        receipt = await repo.prepare_experiment_sizing_receipt(scope,
            epoch, opened["revision"], policy.policy_version,
            request(instrument, initial, evidence, 70, 0))
        command = await reserve_command(engine, scope, epoch, opened,
            policy, initial, receipt, purpose="trade", team="team-a",
            intent="buy-70", revision=opened["revision"])
        reserved = await repo.reserve_intent(command)
        started = await repo.mark_submission_started(scope,
            reserved["reservationId"], "client-buy-70", HASH, epoch,
            opened["authorityEpoch"], reserved["revision"], "submit")
        await asyncio.sleep(0.01)
        observed_at = await db_now(engine)
        base, quote = instrument.base_asset_unit_id, instrument.quote_asset_unit_id
        rows = (asset_posting(base, "b" * 64, "wallet", "wallet", 50),
                asset_posting(base, "b" * 64, "external", "external", -50),
                asset_posting(quote, "c" * 64, "wallet", "wallet", -50),
                asset_posting(quote, "c" * 64, "external", "external", 50))
        fill_command = journal(scope, epoch, started["revision"], identity,
            rows, source_event_id="partial-fill", key="partial-fill",
            observed_at=observed_at)
        partial = await repo.apply_journal_event(fill_command)
        later = post_fill_snapshot(initial, instrument, 50, 50,
            await db_now(engine), identity)
        await AccountObservationRepository(engine).store_experiment_fixture(later)
        checkpoint = await repo.reconcile_account(reconcile(scope, epoch,
            partial["revision"], later, policy, "partial-checkpoint"))
        assert checkpoint["status"] == "quarantined"
        raw = proof_bytes(scope, reserved["reservationId"],
            started["attemptId"], "client-buy-70", later.snapshot_hash,
            observed_at, outcome="filled",
            source_event_hash=fill_command.source_event_hash,
            transaction_id=partial["transactionId"], source_event_id="partial-proof")
        saved = await repo.store_experiment_resolution_fixture(scope, raw, epoch)
        with pytest.raises(FinanceError, match="one complete exact simulated fill"):
            await repo.resolve_reservation(scope, reserved["reservationId"],
                saved["proofHash"], epoch, checkpoint["revision"],
                "partial-must-retain")
        held, _ = await held_rows(engine, scope)
        assert [(row["status"], int(row["units"])) for row in held] == [
            ("submitted", 70)]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_proof_and_reservation_cannot_cross_experiment_account_scope():
    engine = create_async_engine(guarded_dsn())
    try:
        a = await submitted_withdrawal(engine, uuid4().hex)
        b = await setup_spot_account(engine, uuid4().hex)
        repo_a, scope_a, epoch_a, _, snapshot_a, _, reserved, started = a
        repo_b, scope_b, epoch_b, _, _, _, _, opened_b = b
        raw = proof_bytes(scope_a, reserved["reservationId"],
            started["attemptId"], "client-withdraw-70", snapshot_a.snapshot_hash,
            await db_now(engine), outcome="rejected_no_fill",
            source_event_id="foreign-attempt")
        with pytest.raises(FinanceError, match="scope differs"):
            await repo_b.store_experiment_resolution_fixture(scope_b, raw, epoch_b)
        with pytest.raises(FinanceError, match="reservation is unavailable"):
            await repo_b.resolve_reservation(scope_b, reserved["reservationId"],
                "f" * 64, epoch_b, opened_b["revision"], "foreign-proof")
        rows, _ = await held_rows(engine, scope_a)
        assert rows[0]["status"] == "submitted"
    finally:
        await engine.dispose()
