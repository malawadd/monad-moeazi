"""Q3 writer fencing, stop serialization, and unavailable-DB read behavior."""
import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError, FinanceScope, _digest
from moeazi_agent.finance_repository import FinanceRepository
from test_stage2_finance_postgres_reservations import held_rows, reserve_command
from test_stage2_finance_postgres_sizing import guarded_dsn, setup_spot_account


def stop_hash(scope, stopped):
    return _digest("moeazi-finance-command-v1:set-stop", {
        "scope": scope.model_dump(), "stopped": stopped})


@pytest.mark.asyncio
async def test_expired_writer_epoch_cannot_commit_after_new_writer_takes_lease():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, scope, old_epoch, instrument, snapshot, _, policy, opened = \
            await setup_spot_account(engine, uuid4().hex)
        receipt = await repo.prepare_experiment_withdrawal_receipt(scope,
            old_epoch, opened["revision"], policy.policy_version,
            instrument.quote_asset_unit_id, "wallet", "10")
        old_command = await reserve_command(engine, scope, old_epoch, opened,
            policy, snapshot, receipt, purpose="withdrawal", team="owner",
            intent="fenced-withdrawal", revision=opened["revision"])
        async with engine.begin() as conn:
            await conn.execute(text("""
                UPDATE finance_accounts SET writer_lease_until=clock_timestamp()-interval '1 second'
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), scope.model_dump())
        new_epoch = await repo.acquire_writer_epoch(scope, "replacement-verifier")
        assert new_epoch > old_epoch
        with pytest.raises(FinanceError, match="writer epoch"):
            await repo.reserve_intent(old_command)
        assert await held_rows(engine, scope) == ([], 2)
        fresh = old_command.model_copy(update={"writer_epoch": new_epoch})
        accepted = await repo.reserve_intent(fresh)
        assert accepted["status"] == "reserved"
        rows, outbox = await held_rows(engine, scope)
        assert len(rows) == 1 and outbox == 3
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_stop_and_reserve_race_serializes_under_account_revision():
    engine = create_async_engine(guarded_dsn())
    try:
        repo, scope, epoch, instrument, snapshot, _, policy, opened = \
            await setup_spot_account(engine, uuid4().hex)
        receipt = await repo.prepare_experiment_withdrawal_receipt(scope,
            epoch, opened["revision"], policy.policy_version,
            instrument.quote_asset_unit_id, "wallet", "10")
        command = await reserve_command(engine, scope, epoch, opened, policy,
            snapshot, receipt, purpose="withdrawal", team="owner",
            intent="racing-withdrawal", revision=opened["revision"])
        later_command = await reserve_command(engine, scope, epoch, opened, policy,
            snapshot, receipt, purpose="withdrawal", team="owner",
            intent="post-stop-withdrawal", revision=opened["revision"])
        stop = repo.set_account_stop(scope, epoch, opened["revision"],
            stopped=True, idempotency_key="racing-stop",
            request_hash=stop_hash(scope, True))
        reserve = repo.reserve_intent(command)
        stop_result, reserve_result = await asyncio.gather(stop, reserve,
            return_exceptions=True)
        successes = [item for item in (stop_result, reserve_result)
                     if isinstance(item, dict)]
        failures = [item for item in (stop_result, reserve_result)
                    if isinstance(item, BaseException)]
        assert len(successes) == len(failures) == 1
        assert isinstance(failures[0], FinanceError)
        if isinstance(reserve_result, dict):
            stopped = await repo.set_account_stop(scope, epoch,
                reserve_result["revision"], stopped=True,
                idempotency_key="stop-after-reserve",
                request_hash=stop_hash(scope, True))
            assert stopped["state"] == "stopped"
        rows, _ = await held_rows(engine, scope)
        assert len(rows) == (1 if isinstance(reserve_result, dict) else 0)
        async with engine.connect() as conn:
            account = (await conn.execute(text("""
                SELECT revision,admission_state,authority_epoch FROM finance_accounts
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), scope.model_dump())).mappings().one()
        assert account["admission_state"] == "stopped"
        stale = later_command.model_copy(update={"expected_revision": account["revision"],
            "authority_epoch": account["authority_epoch"]})
        with pytest.raises(FinanceError, match="stopped|authority"):
            await repo.reserve_intent(stale)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_unavailable_local_db_never_returns_synthetic_withdrawable_units():
    scope = FinanceScope(environment="experiment", scope_id="unavailable-db",
        strategy_account_id="acct-unavailable-db")
    repo = FinanceRepository("postgresql+asyncpg://invalid:invalid@127.0.0.1:1/none")
    try:
        with pytest.raises(Exception):
            await asyncio.wait_for(repo.read_withdrawable_balance(scope, "USDC:6",
                "wallet"), timeout=1)
    finally:
        await repo.engine.dispose()
