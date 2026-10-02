"""One harmless local Timescale job after reviewed PUBLIC-read revocation."""
import asyncio
import os
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine


DATABASE = "moeazi_q4_extension_20260930"


def extension_dsn():
    raw = os.getenv("MOEAZI_Q4_POSTGRES_DSN")
    if not raw:
        pytest.skip("explicit disposable Q4 extension database opt-in required")
    url = make_url(raw)
    if (url.drivername, url.host, url.port, url.username, url.database) != (
        "postgresql+asyncpg", "127.0.0.1", 15432, "postgres",
        "moeazi_q4_20260930"):
        raise RuntimeError("Only root's disposable loopback Q4 DB may select extension DB")
    return url.set(database=DATABASE).render_as_string(hide_password=False)


@pytest.mark.asyncio
async def test_post_revoke_timescale_background_job_writes_only_local_marker():
    engine = create_async_engine(extension_dsn())
    suffix = uuid4().hex
    table = f"q4_ts_marker_{suffix}"
    procedure = f"q4_ts_job_{suffix}"
    job_id = None
    created_table = created_procedure = False
    try:
        async with engine.begin() as conn:
            version = (await conn.execute(text("""
                SELECT extversion FROM pg_extension WHERE extname='timescaledb'
            """))).scalar_one()
            assert version == "2.28.2"
            await conn.execute(text(f"CREATE TABLE public.{table} ("
                "job_id integer NOT NULL, run_at timestamptz NOT NULL)"))
            created_table = True
            await conn.execute(text(
                f"CREATE PROCEDURE public.{procedure}(job_id integer, config jsonb) "
                f"LANGUAGE plpgsql AS $$ BEGIN "
                f"INSERT INTO public.{table}(job_id,run_at) "
                f"VALUES ($1,clock_timestamp()); END $$"))
            created_procedure = True
            job_id = (await conn.execute(text(f"""
                SELECT add_job('public.{procedure}'::regproc, interval '1 day',
                    initial_start=>clock_timestamp()+interval '1 day',
                    scheduled=>false, config=>'{{}}'::jsonb)
            """))).scalar_one()
        async with engine.connect() as conn:
            await conn.execution_options(isolation_level="AUTOCOMMIT")
            await conn.execute(text("CALL run_job(:job_id)"), {"job_id": job_id})
        async with engine.connect() as conn:
            marker = (await conn.execute(text(
                f"SELECT job_id,run_at FROM public.{table}"))).mappings().all()
            registered = (await conn.execute(text("""
                SELECT scheduled FROM timescaledb_information.jobs WHERE job_id=:job_id
            """), {"job_id": job_id})).scalar_one()
            assert len(marker) == 1 and marker[0]["job_id"] == job_id
            assert marker[0]["run_at"] is not None and registered is False
    finally:
        # No schedule or external call; remove job and local artifacts on failure.
        async with engine.begin() as conn:
            if job_id is not None:
                await conn.execute(text("SELECT delete_job(:job_id)"), {"job_id": job_id})
            if created_procedure:
                await conn.execute(text(f"DROP PROCEDURE public.{procedure}(integer,jsonb)"))
            if created_table:
                await conn.execute(text(f"DROP TABLE public.{table}"))
        await engine.dispose()


@pytest.mark.asyncio
async def test_post_revoke_one_shot_scheduled_job_runs_under_timescale_worker():
    engine = create_async_engine(extension_dsn())
    suffix = uuid4().hex
    table = f"q4_ts_scheduled_marker_{suffix}"
    procedure = f"q4_ts_scheduled_job_{suffix}"
    job_id = None
    created_table = created_procedure = False
    try:
        async with engine.begin() as conn:
            await conn.execute(text(f"CREATE TABLE public.{table} ("
                "job_id integer NOT NULL, run_at timestamptz NOT NULL)"))
            created_table = True
            await conn.execute(text(
                f"CREATE PROCEDURE public.{procedure}(job_id integer, config jsonb) "
                f"LANGUAGE plpgsql AS $$ BEGIN "
                f"INSERT INTO public.{table}(job_id,run_at) "
                f"VALUES ($1,clock_timestamp()); "
                f"PERFORM alter_job($1, scheduled=>false); END $$"))
            created_procedure = True
            job_id = (await conn.execute(text(f"""
                SELECT add_job('public.{procedure}'::regproc, interval '1 day',
                    initial_start=>clock_timestamp()+interval '2 seconds',
                    scheduled=>true, config=>'{{}}'::jsonb)
            """))).scalar_one()
        deadline = asyncio.get_running_loop().time() + 30
        marker = []
        while asyncio.get_running_loop().time() < deadline:
            async with engine.connect() as conn:
                marker = (await conn.execute(text(
                    f"SELECT job_id,run_at FROM public.{table}"))).mappings().all()
            if marker:
                break
            await asyncio.sleep(0.25)
        assert len(marker) == 1 and marker[0]["job_id"] == job_id
        async with engine.connect() as conn:
            scheduled = (await conn.execute(text("""
                SELECT scheduled FROM timescaledb_information.jobs WHERE job_id=:job_id
            """), {"job_id": job_id})).scalar_one()
            stats = (await conn.execute(text("""
                SELECT total_runs,total_successes,total_failures
                FROM timescaledb_information.job_stats WHERE job_id=:job_id
            """), {"job_id": job_id})).mappings().one()
            assert scheduled is False
            assert stats["total_runs"] >= 1 and stats["total_successes"] >= 1
            assert stats["total_failures"] == 0
    finally:
        async with engine.begin() as conn:
            if job_id is not None:
                await conn.execute(text("SELECT delete_job(:job_id)"), {"job_id": job_id})
            if created_procedure:
                await conn.execute(text(f"DROP PROCEDURE public.{procedure}(integer,jsonb)"))
            if created_table:
                await conn.execute(text(f"DROP TABLE public.{table}"))
        await engine.dispose()
