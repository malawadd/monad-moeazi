"""Direct SQL058 invariants on root's disposable Q4 database; no migration apply."""
import json
import os
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine


H = "a" * 64


def guarded_dsn():
    raw = os.getenv("MOEAZI_TEST_POSTGRES_DSN")
    if not raw:
        pytest.skip("SQL058 requires an explicit disposable Q4 PostgreSQL DSN")
    url = make_url(raw)
    if (url.drivername, url.host, url.port, url.database) != (
        "postgresql+asyncpg", "127.0.0.1", 15432, "moeazi_q4_20260930"
    ):
        pytest.fail("Stage 3 SQL tests are restricted to the Q4 disposable DB")
    return raw


async def reject(conn, sql, params):
    with pytest.raises(Exception):
        async with conn.begin_nested():
            await conn.execute(text(sql), params)


@pytest.mark.asyncio
async def test_run_identity_is_immutable_scoped_and_duplicate_manifest_denied():
    engine = create_async_engine(guarded_dsn())
    identity = uuid4().hex
    scope = f"q4-schema-{identity}"
    account = f"acct-{identity}"
    args = {"environment": "experiment", "scope": scope, "account": account,
            "run": "run-1", "hash": H,
            "registration_key": f"register-{identity}",
            "other_key": f"register-other-{identity}",
            "manifest": json.dumps({"manifest_hash": H, "scenario": {
                "simulation_cursor_at": "2026-09-30T00:00:00Z",
                "simulation_end_at": "2026-09-30T00:01:00Z"}}),
            "subject": f"synthetic:{identity}"}
    try:
        async with engine.connect() as conn:
            transaction = await conn.begin()
            try:
                await conn.execute(text("""
                    INSERT INTO finance_accounts(environment,scope_id,strategy_account_id)
                    VALUES(:environment,:scope,:account)
                """), args)
                await conn.execute(text("""
                    INSERT INTO simulation_runs(environment,scope_id,strategy_account_id,
                      run_id,manifest_hash,registration_key,manifest_json,scenario_hash,created_by_subject,
                      experiment_request_hash,authority_fingerprint,authority_epoch,status)
                    VALUES(:environment,:scope,:account,:run,:hash,:registration_key,CAST(:manifest AS jsonb),
                      :hash,:subject,:hash,:hash,1,'registered')
                """), args)
                await reject(conn, """
                    UPDATE simulation_runs SET manifest_hash=:changed
                    WHERE environment=:environment AND scope_id=:scope
                      AND strategy_account_id=:account AND run_id=:run
                """, {**args, "changed": "b" * 64})
                await reject(conn, """
                    UPDATE simulation_runs SET authority_epoch=2
                    WHERE environment=:environment AND scope_id=:scope
                      AND strategy_account_id=:account AND run_id=:run
                """, args)
                await reject(conn, """
                    DELETE FROM simulation_runs WHERE environment=:environment
                      AND scope_id=:scope AND strategy_account_id=:account
                      AND run_id=:run
                """, args)
                await reject(conn, """
                    INSERT INTO simulation_runs(environment,scope_id,strategy_account_id,
                      run_id,manifest_hash,registration_key,manifest_json,scenario_hash,created_by_subject,
                      experiment_request_hash,authority_fingerprint,authority_epoch,status)
                    VALUES(:environment,:scope,:account,'run-2',:hash,:other_key,
                      CAST(:manifest AS jsonb),:hash,:subject,:hash,:hash,1,'registered')
                """, args)
                await reject(conn, """
                    UPDATE simulation_runs SET status='completed_flat',
                      pending_obligations=true WHERE environment=:environment
                      AND scope_id=:scope AND strategy_account_id=:account
                      AND run_id=:run
                """, args)
                await reject(conn, """
                    INSERT INTO simulation_runs(environment,scope_id,strategy_account_id,
                      run_id,manifest_hash,registration_key,manifest_json,scenario_hash,created_by_subject,
                      experiment_request_hash,authority_fingerprint,authority_epoch,status)
                    VALUES('live','live',:account,'live-escape',:hash,:other_key,
                      CAST(:manifest AS jsonb),:hash,:subject,:hash,:hash,1,'registered')
                """, args)
                row = (await conn.execute(text("""
                    SELECT status,manifest_hash,authority_epoch FROM simulation_runs
                    WHERE environment=:environment AND scope_id=:scope
                      AND strategy_account_id=:account AND run_id=:run
                """), args)).one()
                assert row == ("registered", H, 1)
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
