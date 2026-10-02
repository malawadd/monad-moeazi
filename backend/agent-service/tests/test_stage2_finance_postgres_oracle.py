"""Independent multi-asset totals through the real SQL journal, not native trading."""
import hashlib
import os
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import (
    FinanceError, FinanceScope, JournalCommand, JournalPosting,
    semantic_request_hash, source_event_digest,
)
from moeazi_agent.finance_repository import FinanceRepository


HASH = "a" * 64
USDC, BTC, ETH = "USDC:6", "BTC:8", "ETH:18"


async def setup():
    dsn = os.getenv("MOEAZI_TEST_POSTGRES_DSN")
    if not dsn:
        pytest.skip("explicit disposable DB required")
    url = make_url(dsn)
    if (url.drivername, url.host, url.port, url.database) != (
            "postgresql+asyncpg", "127.0.0.1", 15432, "moeazi_q3_20260930"):
        pytest.fail("oracle refuses any other database")
    db = create_async_engine(dsn)
    scope = FinanceScope(environment="experiment", scope_id="oracle-" + uuid4().hex,
                         strategy_account_id="oracle-" + uuid4().hex)
    repo = FinanceRepository(db)
    epoch = await repo.acquire_writer_epoch(scope, "sql-oracle", 120)
    return db, repo, scope, epoch


def p(asset, location, book, units):
    return JournalPosting(asset_unit_id=asset, location_id=location, book=book,
                          units=str(units), registry_hash=HASH)


async def apply(repo, scope, epoch, revision, key, kind, postings, reverses=None):
    async with repo.engine.connect() as conn:
        now = (await conn.execute(text("SELECT clock_timestamp()"))).scalar_one()
    body = dict(scope=scope, writer_epoch=epoch, expected_revision=revision,
        idempotency_key=key, request_hash=HASH, source_owner="independent_oracle",
        source_stream="cash_events", source_event_id=key, source_revision="1",
        source_event_hash=HASH, source_payload_hash=hashlib.sha256(key.encode()).hexdigest(),
        kind=kind, observed_at=now, postings=tuple(postings), reverses_transaction_id=reverses)
    body["source_event_hash"] = source_event_digest(JournalCommand.model_construct(**body))
    body["request_hash"] = semantic_request_hash("journal", JournalCommand.model_construct(**body))
    return await repo.apply_journal_event(JournalCommand.model_validate(body))


async def balances(db, scope):
    async with db.connect() as conn:
        rows = (await conn.execute(text("""
            SELECT asset_unit_id,location_id,book,units FROM finance_balances
            WHERE environment='experiment' AND scope_id=:scope AND strategy_account_id=:account
        """), {"scope": scope.scope_id, "account": scope.strategy_account_id})).mappings().all()
        return {(r["asset_unit_id"], r["location_id"], r["book"]): int(r["units"]) for r in rows}


async def opening(repo, scope, epoch):
    return await apply(repo, scope, epoch, 0, "opening", "opening", (
        p(USDC, "wallet", "wallet", 1_000_000_000),
        p(USDC, "external", "external", -1_000_000_000),
        p(ETH, "wallet", "wallet", 10_000_000_000_000_000),
        p(ETH, "external", "external", -10_000_000_000_000_000)))


@pytest.mark.asyncio
async def test_sql_spot_partial_fills_third_asset_fee_sale_and_full_correction():
    db, repo, scope, epoch = await setup()
    try:
        result = await opening(repo, scope, epoch)
        for number in range(2):
            result = await apply(repo, scope, epoch, result["revision"], f"fill-{number}", "fill", (
                p(BTC, "wallet", "wallet", 1_000_000), p(BTC, "external", "external", -1_000_000),
                p(USDC, "wallet", "wallet", -250_000_000), p(USDC, "external", "external", 250_000_000),
                p(ETH, "wallet", "wallet", -600_000_000_000_000),
                p(ETH, "fees", "fees", 600_000_000_000_000)))
        result = await apply(repo, scope, epoch, result["revision"], "sale", "fill", (
            p(BTC, "wallet", "wallet", -1_000_000), p(BTC, "external", "external", 1_000_000),
            p(USDC, "wallet", "wallet", 260_000_000), p(USDC, "external", "external", -260_000_000)))
        state = await balances(db, scope)
        assert state[(USDC, "wallet", "wallet")] == 760_000_000
        assert state[(BTC, "wallet", "wallet")] == 1_000_000
        assert state[(ETH, "wallet", "wallet")] == 8_800_000_000_000_000
        assert state[(ETH, "fees", "fees")] == 1_200_000_000_000_000
        incorrect_fee = (p(ETH, "wallet", "wallet", -50), p(ETH, "fees", "fees", 50))
        mistaken = await apply(repo, scope, epoch, result["revision"], "incorrect-fee", "fee", incorrect_fee)
        reversal = tuple(row.model_copy(update={"units": str(-int(row.units))}) for row in incorrect_fee)
        corrected = await apply(repo, scope, epoch, mistaken["revision"], "reverse-fee", "correction_reversal",
                                reversal, mistaken["transactionId"])
        assert await balances(db, scope) == state
        with pytest.raises(FinanceError, match="already has a full reversal"):
            await apply(repo, scope, epoch, corrected["revision"], "reverse-again", "correction_reversal",
                        reversal, mistaken["transactionId"])
    finally:
        await db.dispose()


@pytest.mark.asyncio
async def test_sql_collateral_funding_transit_gas_and_external_cashflow():
    db, repo, scope, epoch = await setup()
    try:
        result = await opening(repo, scope, epoch)
        events = (
            ("margin", "transfer", (p(USDC, "wallet", "wallet", -100_000_000),
                p(USDC, "venue", "collateral", 100_000_000))),
            ("funding", "funding", (p(USDC, "venue", "collateral", -2_000_000),
                p(USDC, "funding", "funding", 2_000_000))),
            ("gas", "gas", (p(ETH, "wallet", "wallet", -100_000_000_000_000),
                p(ETH, "gas", "gas", 100_000_000_000_000))),
            ("leave", "transfer", (p(USDC, "wallet", "wallet", -40_000_000),
                p(USDC, "bridge", "transit", 40_000_000))),
            ("arrive", "transfer", (p(USDC, "bridge", "transit", -40_000_000),
                p(USDC, "destination", "wallet", 40_000_000))),
            ("deposit", "deposit", (p(USDC, "wallet", "wallet", 100_000_000),
                p(USDC, "external", "external", -100_000_000))),
            ("withdraw", "withdrawal", (p(USDC, "wallet", "wallet", -50_000_000),
                p(USDC, "external", "external", 50_000_000))),
        )
        for key, kind, legs in events:
            result = await apply(repo, scope, epoch, result["revision"], key, kind, legs)
            if key == "leave":
                pending = await balances(db, scope)
                assert pending[(USDC, "bridge", "transit")] == 40_000_000
                assert (USDC, "destination", "wallet") not in pending
        state = await balances(db, scope)
        assert state[(USDC, "wallet", "wallet")] == 910_000_000
        assert state[(USDC, "venue", "collateral")] == 98_000_000
        assert state[(USDC, "destination", "wallet")] == 40_000_000
        assert state[(USDC, "bridge", "transit")] == 0
        assert state[(ETH, "wallet", "wallet")] == 9_900_000_000_000_000
        assets = sum(amount for (asset, _, book), amount in state.items()
                     if asset == USDC and book in {"wallet", "collateral", "transit"})
        assert assets == 1_048_000_000
        assert assets - 1_000_000_000 - (100_000_000 - 50_000_000) == -2_000_000
        assert not any(book == "pnl" for (_, _, book) in state)  # no unrealized mark minted as cash
    finally:
        await db.dispose()
