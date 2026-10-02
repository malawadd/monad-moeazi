"""Actual disposable-Q4 login-role isolation; never targets an application DB."""
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent.finance_contracts import FinanceError
from moeazi_agent.simulation_database_guard import verify_simulation_database_role


ROOT = Path(__file__).resolve().parents[2]
CHECKPOINT = ROOT / ".data" / "q4-simulation-db.json"


def guarded_dsn(raw, user):
    url = make_url(raw)
    if (url.drivername, url.host, url.port, url.database, url.username) != (
        "postgresql+asyncpg", "127.0.0.1", 15432, "moeazi_q4_20260930", user):
        raise RuntimeError("Stage3 role test permits only root's disposable loopback Q4 DB")
    return raw


def qualification():
    if not CHECKPOINT.exists():
        pytest.skip("root-provisioned disposable simulation-role checkpoint required")
    record = json.loads(CHECKPOINT.read_text(encoding="utf-8"))
    assert set(record) == {"dsn", "role", "live_canary_account", "database"}
    assert record["database"] == "moeazi_q4_20260930"
    assert record["role"] == "moeazi_q4_sim_20260930"
    assert isinstance(record["live_canary_account"], str) and record["live_canary_account"]
    guarded_dsn(record["dsn"], record["role"])
    return record


@pytest.mark.asyncio
async def test_simulation_login_cannot_read_or_write_live_financial_namespace():
    record = qualification()
    engine = create_async_engine(record["dsn"])
    try:
        async with engine.connect() as conn:
            role = (await conn.execute(text("""
                SELECT current_user AS name,r.rolsuper,r.rolbypassrls,r.rolcreaterole,
                  r.rolcreatedb,r.rolcanlogin,
                  pg_has_role(current_user,'moeazi_simulation_writer','member') AS grouped,
                  has_schema_privilege(current_user,'public','CREATE') AS can_create,
                  has_table_privilege(current_user,'finance_outbox','UPDATE') AS can_ack
                FROM pg_roles r WHERE r.rolname=current_user
            """))).mappings().one()
            assert role["name"] == record["role"] and role["rolcanlogin"]
            assert role["grouped"] and not any(role[key] for key in (
                "rolsuper", "rolbypassrls", "rolcreaterole", "rolcreatedb",
                "can_create", "can_ack"))
            hidden = (await conn.execute(text("""
                SELECT count(*) FROM finance_accounts WHERE environment='live'
                  AND strategy_account_id=:account
            """), {"account": record["live_canary_account"]})).scalar_one()
            assert hidden == 0
            # UPDATE has a table grant for experimental work, but RLS must
            # filter the existing live row rather than silently mutating it.
            changed = await conn.execute(text("""
                UPDATE finance_accounts SET admission_state='stopped'
                WHERE environment='live' AND strategy_account_id=:account
            """), {"account": record["live_canary_account"]})
            assert changed.rowcount == 0
            scope = "q4-role-" + uuid4().hex
            account = "q4-role-account-" + uuid4().hex
            await conn.execute(text("""
                INSERT INTO finance_accounts(environment,scope_id,strategy_account_id)
                VALUES('experiment',:scope,:account)
            """), {"scope": scope, "account": account})
            visible = (await conn.execute(text("""
                SELECT count(*) FROM finance_accounts WHERE environment='experiment'
                  AND scope_id=:scope AND strategy_account_id=:account
            """), {"scope": scope, "account": account})).scalar_one()
            assert visible == 1
            live_insert = await conn.begin_nested()
            with pytest.raises(DBAPIError):
                await conn.execute(text("""
                    INSERT INTO finance_accounts(environment,scope_id,strategy_account_id)
                    VALUES('live','live',:account)
                """), {"account": "q4-forbidden-" + uuid4().hex})
            await live_insert.rollback()
            forged = await conn.begin_nested()
            with pytest.raises(DBAPIError):
                await conn.execute(text("""
                    INSERT INTO finance_outbox(environment,scope_id,strategy_account_id,
                      account_revision,event_id,payload_hash,payload)
                    VALUES('experiment',:scope,:account,1,:event,:hash,
                      CAST(:payload AS jsonb))
                """), {"scope": scope, "account": account,
                       "event": uuid4().hex, "hash": "a" * 64,
                       "payload": json.dumps({"environment": "live", "scopeId": "live",
                           "strategyAccountId": record["live_canary_account"],
                           "accountRevision": "1"})})
            await forged.rollback()
            await conn.rollback()  # no persistent role-test account or outbox row
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_baseline_application_role_still_sees_root_live_canary():
    record = qualification()
    raw = os.getenv("MOEAZI_Q4_POSTGRES_DSN")
    if not raw:
        pytest.skip("explicit disposable Q4 baseline-role DSN required")
    engine = create_async_engine(guarded_dsn(raw, "postgres"))
    try:
        async with engine.connect() as conn:
            count = (await conn.execute(text("""
                SELECT count(*) FROM finance_accounts WHERE environment='live'
                  AND strategy_account_id=:account
            """), {"account": record["live_canary_account"]})).scalar_one()
            assert count == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("mutation", ["column_grant", "select_only_policy"])
async def test_startup_guard_rejects_transactional_privilege_drift(mutation):
    record = qualification()
    raw = os.getenv("MOEAZI_Q4_POSTGRES_DSN")
    if not raw:
        pytest.skip("explicit disposable Q4 baseline-role DSN required")
    engine = create_async_engine(guarded_dsn(raw, "postgres"))

    class BorrowedEngine:
        def __init__(self, conn):
            self.conn = conn

        @asynccontextmanager
        async def connect(self):
            yield self.conn

    try:
        async with engine.connect() as conn:
            transaction = await conn.begin()
            try:
                if mutation == "column_grant":
                    await conn.execute(text("""
                        GRANT UPDATE (payload) ON finance_outbox
                        TO moeazi_q4_sim_20260930
                    """))
                else:
                    await conn.execute(text("""
                        DROP POLICY simulation_experiment_only ON finance_accounts
                    """))
                    await conn.execute(text("""
                        CREATE POLICY simulation_experiment_only ON finance_accounts
                          AS RESTRICTIVE FOR SELECT TO moeazi_simulation_writer
                          USING (environment='experiment')
                    """))
                await conn.execute(text("SET LOCAL ROLE moeazi_q4_sim_20260930"))
                with pytest.raises(FinanceError):
                    await verify_simulation_database_role(BorrowedEngine(conn))
            finally:
                await transaction.rollback()  # no privilege or policy change survives
        simulation = create_async_engine(record["dsn"])
        try:
            await verify_simulation_database_role(simulation)
        finally:
            await simulation.dispose()
    finally:
        await engine.dispose()
