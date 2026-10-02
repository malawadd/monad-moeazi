"""Q3 account-serialized holds, retries, and outbox durability on local PostgreSQL."""
import asyncio
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.controller_contracts import ControllerRef
from moeazi_agent.finance_contracts import (
    FinanceError, ReservationComponent, ReserveCommand, semantic_request_hash,
)
from moeazi_agent.finance_policy import SizingRequest
from moeazi_agent.finance_repository import FinanceRepository
from test_stage2_finance_postgres_sizing import guarded_dsn, setup_spot_account


HASH = "a" * 64
BASE_REGISTRY = "b" * 64
QUOTE_REGISTRY = "c" * 64


def request(instrument, snapshot, evidence, units, existing):
    return SizingRequest(action="spot_buy",
        instrument_version_id=instrument.instrument_version_id,
        desired_quantity_units=str(units),
        quantity_asset_unit_id=instrument.base_asset_unit_id,
        quantity_registry_hash=BASE_REGISTRY,
        quote_asset_unit_id=instrument.quote_asset_unit_id,
        quote_registry_hash=QUOTE_REGISTRY, location_id="wallet",
        quote_per_quantity_numerator="1", quote_per_quantity_denominator="1",
        price_snapshot_hash=evidence.snapshot_hash,
        account_snapshot_hash=snapshot.snapshot_hash,
        existing_gross_notional_units=str(existing),
        existing_directional_notional_units=str(existing))


async def reserve_command(engine, scope, epoch, opened, sizing_policy, snapshot,
                          receipt, *, purpose, team, intent, revision):
    async with engine.connect() as conn:
        now = (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()
    controller = ControllerRef(schemaVersion=1, environment="experiment",
        strategyAccountId=scope.strategy_account_id,
        controllerKind="customer_team", controllerId=team,
        controllerVersionId=f"{team}:v1", contentHash=HASH)
    body = dict(scope=scope, controller_ref=controller,
        controller_mode="shadow", expected_revision=revision,
        writer_epoch=epoch, authority_epoch=opened["authorityEpoch"],
        authority_fingerprint=HASH, idempotency_key=intent, request_hash=HASH,
        intent_id=intent, purpose=purpose,
        policy_version=sizing_policy.policy_version,
        policy_hash=sizing_policy.policy_hash,
        snapshot_hash=snapshot.snapshot_hash,
        calculation_receipt_hash=receipt["receipt_hash"],
        components=tuple(ReservationComponent.model_validate(row)
                         for row in receipt["components"]),
        expires_at=now + timedelta(seconds=30))
    return ReserveCommand.model_validate(body | {
        "request_hash": semantic_request_hash("reserve",
            ReserveCommand.model_construct(**body))})


async def held_rows(engine, scope):
    async with engine.connect() as conn:
        rows = (await conn.execute(text("""
            SELECT r.intent_id,r.status,c.units,r.purpose FROM finance_reservations r
            JOIN finance_reservation_components c USING
              (environment,scope_id,strategy_account_id,reservation_id)
            WHERE r.scope_id=:scope AND r.strategy_account_id=:account
        """), {"scope": scope.scope_id,
               "account": scope.strategy_account_id})).mappings().all()
        outbox = (await conn.execute(text("SELECT count(*) FROM finance_outbox "
            "WHERE scope_id=:scope AND strategy_account_id=:account"),
            {"scope": scope.scope_id,
             "account": scope.strategy_account_id})).scalar_one()
    return [dict(row) for row in rows], outbox


@pytest.mark.asyncio
async def test_two_team_buys_and_withdrawal_exactly_fill_capacity_then_deny_one():
    engine = create_async_engine(guarded_dsn())
    try:
        identity = uuid4().hex
        repo, scope, epoch, instrument, snapshot, evidence, sizing_policy, opened = \
            await setup_spot_account(engine, identity)
        revision = opened["revision"]
        for team, units, existing in [("team-a", 70, 0), ("team-b", 20, 70)]:
            receipt = await repo.prepare_experiment_sizing_receipt(scope, epoch,
                revision, sizing_policy.policy_version,
                request(instrument, snapshot, evidence, units, existing))
            command = await reserve_command(engine, scope, epoch, opened,
                sizing_policy, snapshot, receipt, purpose="trade", team=team,
                intent=f"{team}:buy", revision=revision)
            result = await repo.reserve_intent(command)
            assert result["status"] == "reserved"
            revision = result["revision"]
        receipt = await repo.prepare_experiment_withdrawal_receipt(scope,
            epoch, revision, sizing_policy.policy_version,
            instrument.quote_asset_unit_id, "wallet", "10")
        command = await reserve_command(engine, scope, epoch, opened,
            sizing_policy, snapshot, receipt, purpose="withdrawal",
            team="owner", intent="withdraw-10", revision=revision)
        result = await repo.reserve_intent(command)
        revision = result["revision"]
        rows, outbox = await held_rows(engine, scope)
        assert {row["intent_id"]: int(row["units"]) for row in rows} == {
            "team-a:buy": 70, "team-b:buy": 20, "withdraw-10": 10}
        assert sum(int(row["units"]) for row in rows) == 100
        assert outbox == 5  # opening, admit, three committed reservations
        extra = await repo.prepare_experiment_withdrawal_receipt(scope,
            epoch, revision, sizing_policy.policy_version,
            instrument.quote_asset_unit_id, "wallet", "1")
        with pytest.raises(FinanceError, match="over-reserved"):
            await repo.reserve_intent(await reserve_command(engine, scope,
                epoch, opened, sizing_policy, snapshot, extra,
                purpose="withdrawal", team="owner", intent="withdraw-1",
                revision=revision))
        assert await held_rows(engine, scope) == (rows, outbox)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_concurrent_stale_writers_retry_without_overbooking_or_duplication():
    engine = create_async_engine(guarded_dsn())
    try:
        identity = uuid4().hex
        repo, scope, epoch, instrument, snapshot, evidence, sizing_policy, opened = \
            await setup_spot_account(engine, identity)
        revision = opened["revision"]
        proposed = []
        for team, units in [("team-a", 70), ("team-b", 60)]:
            receipt = await repo.prepare_experiment_sizing_receipt(scope, epoch,
                revision, sizing_policy.policy_version,
                request(instrument, snapshot, evidence, units, 0))
            proposed.append(await reserve_command(engine, scope, epoch, opened,
                sizing_policy, snapshot, receipt, purpose="trade", team=team,
                intent=f"{team}:buy", revision=revision))
        receipt = await repo.prepare_experiment_withdrawal_receipt(scope,
            epoch, revision, sizing_policy.policy_version,
            instrument.quote_asset_unit_id, "wallet", "50")
        proposed.append(await reserve_command(engine, scope, epoch, opened,
            sizing_policy, snapshot, receipt, purpose="withdrawal", team="owner",
            intent="withdraw-50", revision=revision))
        results = await asyncio.gather(*(repo.reserve_intent(item)
            for item in proposed), return_exceptions=True)
        successes = [row for row in results if isinstance(row, dict)]
        assert len(successes) == 1
        assert all(isinstance(row, FinanceError) for row in results
                   if not isinstance(row, dict))
        rows, outbox = await held_rows(engine, scope)
        assert len(rows) == 1 and outbox == 3
        committed = int(rows[0]["units"])
        assert committed in {50, 60, 70}
        # A lost client response must not create another hold after restart.
        winner = proposed[results.index(successes[0])]
        restarted = FinanceRepository(engine)
        assert await restarted.reserve_intent(winner) == successes[0]
        assert await held_rows(engine, scope) == (rows, outbox)
        # Retry each loser with fresh authoritative revision and a new receipt.
        revision = successes[0]["revision"]
        gross = committed if rows[0]["purpose"] == "trade" else 0
        for index, original in enumerate(proposed):
            if original == winner:
                continue
            units = [70, 60, 50][index]
            if index < 2:
                fresh = await repo.prepare_experiment_sizing_receipt(scope, epoch,
                    revision, sizing_policy.policy_version,
                    request(instrument, snapshot, evidence, units, gross))
                purpose = "trade"
            else:
                fresh = await repo.prepare_experiment_withdrawal_receipt(scope,
                    epoch, revision, sizing_policy.policy_version,
                    instrument.quote_asset_unit_id, "wallet", str(units))
                purpose = "withdrawal"
            retry = await reserve_command(engine, scope, epoch, opened,
                sizing_policy, snapshot, fresh, purpose=purpose,
                team=["team-a", "team-b", "owner"][index],
                intent=original.intent_id, revision=revision)
            try:
                accepted = await repo.reserve_intent(retry)
            except FinanceError:
                continue
            revision = accepted["revision"]
            if purpose == "trade":
                gross += int(fresh["notional_units"])
        final, final_outbox = await held_rows(engine, scope)
        assert sum(int(row["units"]) for row in final) <= 100
        assert len({row["intent_id"] for row in final}) == len(final)
        assert final_outbox == 2 + len(final)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_pending_buys_exhaust_gross_cap_even_with_extra_cash():
    engine = create_async_engine(guarded_dsn())
    try:
        identity = uuid4().hex
        repo, scope, epoch, instrument, snapshot, evidence, sizing_policy, opened = \
            await setup_spot_account(engine, identity, quote_units="1000",
                max_gross="100", max_quantity="100")
        revision = opened["revision"]
        for team, units, existing in [("team-a", 70, 0), ("team-b", 30, 70)]:
            receipt = await repo.prepare_experiment_sizing_receipt(scope, epoch,
                revision, sizing_policy.policy_version,
                request(instrument, snapshot, evidence, units, existing))
            command = await reserve_command(engine, scope, epoch, opened,
                sizing_policy, snapshot, receipt, purpose="trade", team=team,
                intent=f"{team}:buy", revision=revision)
            revision = (await repo.reserve_intent(command))["revision"]
        rows, outbox = await held_rows(engine, scope)
        assert sum(int(row["units"]) for row in rows) == 100
        assert outbox == 4
        with pytest.raises(FinanceError, match="cap reached"):
            await repo.prepare_experiment_sizing_receipt(scope, epoch,
                revision, sizing_policy.policy_version,
                request(instrument, snapshot, evidence, 1, 100))
        assert await held_rows(engine, scope) == (rows, outbox)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_possible_submission_remains_held_after_expiry():
    engine = create_async_engine(guarded_dsn())
    try:
        identity = uuid4().hex
        repo, scope, epoch, instrument, snapshot, _, sizing_policy, opened = \
            await setup_spot_account(engine, identity)
        revision = opened["revision"]
        receipt = await repo.prepare_experiment_withdrawal_receipt(scope,
            epoch, revision, sizing_policy.policy_version,
            instrument.quote_asset_unit_id, "wallet", "70")
        command = await reserve_command(engine, scope, epoch, opened,
            sizing_policy, snapshot, receipt, purpose="withdrawal",
            team="owner", intent="possibly-sent", revision=revision)
        reserved = await repo.reserve_intent(command)
        started = await repo.mark_submission_started(scope,
            reserved["reservationId"], "client-possible", HASH, epoch,
            opened["authorityEpoch"], reserved["revision"], "submit")
        uncertain = await repo.mark_submission_uncertain(scope,
            reserved["reservationId"], epoch, started["revision"], "uncertain")
        # Time fault injection is limited to the disposable test DB.
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE finance_reservations SET "
                "expires_at=clock_timestamp()-interval '1 second' "
                "WHERE scope_id=:scope AND reservation_id=:id"),
                {"scope": scope.scope_id, "id": reserved["reservationId"]})
        with pytest.raises(FinanceError, match="possible submission"):
            await repo.release_expired_unsubmitted(scope,
                reserved["reservationId"], epoch, uncertain["revision"],
                "expiry-should-retain")
        rows, outbox = await held_rows(engine, scope)
        assert [(row["status"], int(row["units"])) for row in rows] == [
            ("uncertain", 70)]
        assert outbox == 5  # opening, admit, reserve, submit, uncertain
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_expired_never_submitted_reservation_releases_once():
    engine = create_async_engine(guarded_dsn())
    try:
        identity = uuid4().hex
        repo, scope, epoch, instrument, snapshot, _, policy, opened = \
            await setup_spot_account(engine, identity)
        receipt = await repo.prepare_experiment_withdrawal_receipt(scope,
            epoch, opened["revision"], policy.policy_version,
            instrument.quote_asset_unit_id, "wallet", "10")
        command = await reserve_command(engine, scope, epoch, opened,
            policy, snapshot, receipt, purpose="withdrawal", team="owner",
            intent="never-sent", revision=opened["revision"])
        reserved = await repo.reserve_intent(command)
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE finance_reservations SET "
                "expires_at=clock_timestamp()-interval '1 second' "
                "WHERE scope_id=:scope AND reservation_id=:id"),
                {"scope": scope.scope_id, "id": reserved["reservationId"]})
        released = await repo.release_expired_unsubmitted(scope,
            reserved["reservationId"], epoch, reserved["revision"], "expiry")
        assert released["status"] == "released"
        assert await FinanceRepository(engine).release_expired_unsubmitted(scope,
            reserved["reservationId"], epoch, reserved["revision"], "expiry") == released
        rows, _ = await held_rows(engine, scope)
        assert rows[0]["status"] == "released"
    finally:
        await engine.dispose()
