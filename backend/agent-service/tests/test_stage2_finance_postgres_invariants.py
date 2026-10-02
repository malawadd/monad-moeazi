"""Direct SQL invariant checks, restricted to the supervisor's disposable DB."""
import hashlib
import os
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine


def engine():
    dsn = os.getenv("MOEAZI_TEST_POSTGRES_DSN")
    if not dsn:
        pytest.skip("explicit disposable finance database is required")
    url = make_url(dsn)
    if (url.drivername, url.host, url.port, url.database) != (
            "postgresql+asyncpg", "127.0.0.1", 15432, "moeazi_q3_20260930"):
        pytest.fail("invariant tests refuse any other database")
    return create_async_engine(dsn)


@pytest.mark.asyncio
async def test_native_numeric_domain_rejects_fractional_nonfinite_and_overflow():
    db = engine()
    try:
        for invalid in ("1.5", "-0.1", "1e78", "-1e78", "NaN", "Infinity", "-Infinity"):
            with pytest.raises(DBAPIError):
                async with db.begin() as conn:
                    await conn.execute(text("SELECT CAST(:units AS finance_native_units)"),
                                       {"units": Decimal(invalid)})
        async with db.connect() as conn:
            for valid in ("0", "9007199254740993", "-9007199254740993", "9" * 78):
                result = await conn.execute(text("SELECT CAST(:units AS finance_native_units)"),
                                            {"units": Decimal(valid)})
                assert result.scalar_one() == Decimal(valid)
    finally:
        await db.dispose()


async def transaction(conn, params, transaction_id, posting_count):
    await conn.execute(text("""
        INSERT INTO finance_journal_transactions(environment,scope_id,strategy_account_id,
          transaction_id,source_event_hash,posting_count,request_hash,account_revision)
        VALUES('experiment',:scope,:account,:tx,:hash,:count,:hash,1)
    """), {**params, "tx": transaction_id, "count": posting_count})


async def posting(conn, params, transaction_id, ordinal, units):
    await conn.execute(text("""
        INSERT INTO finance_journal_postings(environment,scope_id,strategy_account_id,
          transaction_id,ordinal,asset_unit_id,registry_hash,location_id,book,units)
        VALUES('experiment',:scope,:account,:tx,:ordinal,'USDC:6',:hash,
          :location,:book,:units)
    """), {**params, "tx": transaction_id, "ordinal": ordinal, "units": Decimal(units),
           "location": "wallet" if ordinal % 2 else "external",
           "book": "wallet" if ordinal % 2 else "external"})


@pytest.mark.asyncio
async def test_committed_history_cannot_be_mutated_or_extended():
    db = engine()
    identity = "sql-invariant-" + uuid4().hex
    params = {"scope": identity, "account": identity,
              "hash": hashlib.sha256(identity.encode()).hexdigest()}
    try:
        async with db.begin() as conn:
            await conn.execute(text("""
                INSERT INTO finance_accounts(environment,scope_id,strategy_account_id)
                VALUES('experiment',:scope,:account)
            """), params)
            await conn.execute(text("""
                INSERT INTO finance_source_events(environment,scope_id,strategy_account_id,
                  source_event_hash,source_owner,source_stream,source_event_id,source_revision,
                  source_payload_hash,event_kind,observed_at)
                VALUES('experiment',:scope,:account,:hash,'fixture','invariant','opening',
                  '1',:hash,'opening',clock_timestamp())
            """), params)
            await transaction(conn, params, "committed", 2)
            await posting(conn, params, "committed", 1, "100")
            await posting(conn, params, "committed", 2, "-100")
        # The baseline transaction is committed before each adversarial transaction.
        for table in ("finance_source_events", "finance_journal_transactions",
                      "finance_journal_postings"):
            for operation in (f"DELETE FROM {table}",
                              f"UPDATE {table} SET scope_id=scope_id"):
                with pytest.raises(DBAPIError, match="history is immutable"):
                    async with db.begin() as conn:
                        await conn.execute(text(operation + " WHERE environment='experiment'"
                            " AND scope_id=:scope AND strategy_account_id=:account"), params)
        with pytest.raises(DBAPIError, match="not balanced"):
            async with db.begin() as conn:
                # Even a balanced appended pair cannot extend immutable posting_count.
                await posting(conn, params, "committed", 3, "25")
                await posting(conn, params, "committed", 4, "-25")
        async with db.connect() as conn:
            count = await conn.execute(text("""
                SELECT count(*) FROM finance_journal_postings WHERE scope_id=:scope
                  AND strategy_account_id=:account AND transaction_id='committed'
            """), params)
            assert count.scalar_one() == 2
    finally:
        await db.dispose()


@pytest.mark.asyncio
async def test_missing_or_unbalanced_postings_abort_transaction_commit():
    db = engine()
    identity = "sql-unbalanced-" + uuid4().hex
    params = {"scope": identity, "account": identity,
              "hash": hashlib.sha256(identity.encode()).hexdigest()}
    try:
        async with db.begin() as conn:
            await conn.execute(text("""
                INSERT INTO finance_accounts(environment,scope_id,strategy_account_id)
                VALUES('experiment',:scope,:account)
            """), params)
            await conn.execute(text("""
                INSERT INTO finance_source_events(environment,scope_id,strategy_account_id,
                  source_event_hash,source_owner,source_stream,source_event_id,source_revision,
                  source_payload_hash,event_kind,observed_at)
                VALUES('experiment',:scope,:account,:hash,'fixture','invariant','event',
                  '1',:hash,'opening',clock_timestamp())
            """), params)
        for malformed in ("empty", "unbalanced"):
            with pytest.raises(DBAPIError, match="not balanced"):
                async with db.begin() as conn:
                    await transaction(conn, params, malformed, 2)
                    if malformed == "unbalanced":
                        await posting(conn, params, malformed, 1, "100")
                        await posting(conn, params, malformed, 2, "-99")
        async with db.connect() as conn:
            result = await conn.execute(text("""
                SELECT count(*) FROM finance_journal_transactions WHERE scope_id=:scope
                  AND strategy_account_id=:account
            """), params)
            assert result.scalar_one() == 0
    finally:
        await db.dispose()
