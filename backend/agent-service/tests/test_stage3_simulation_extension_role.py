"""Timescale PUBLIC metadata is not readable by the isolated simulation login."""
import json
import os
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine


ROOT = Path(__file__).resolve().parents[2]
CHECKPOINT = ROOT / ".data" / "q4-simulation-db.json"
DATABASE = "moeazi_q4_extension_20260930"
TARGETS = (
    "_timescaledb_config.bgw_job",
    "_timescaledb_catalog.bgw_job",
    "timescaledb_information.jobs",
    "timescaledb_information.job_history",
    "timescaledb_information.job_errors",
)


def dsn_for(user):
    if not CHECKPOINT.exists():
        pytest.skip("root-provisioned simulation login is required")
    record = json.loads(CHECKPOINT.read_text(encoding="utf-8"))
    raw = record["dsn"] if user == record["role"] else os.getenv("MOEAZI_Q4_POSTGRES_DSN")
    if not raw:
        pytest.skip("explicit disposable Q4 baseline role is required")
    url = make_url(raw)
    if (url.drivername, url.host, url.port, url.username) != (
        "postgresql+asyncpg", "127.0.0.1", 15432, user):
        raise RuntimeError("Only root's disposable loopback Q4 roles are permitted")
    return url.set(database=DATABASE).render_as_string(hide_password=False)


@pytest.mark.asyncio
async def test_extension_catalog_job_views_refuse_simulation_login():
    record = json.loads(CHECKPOINT.read_text(encoding="utf-8")) if CHECKPOINT.exists() else None
    if record is None:
        pytest.skip("root-provisioned simulation login is required")
    engine = create_async_engine(dsn_for(record["role"]))
    try:
        for relation in TARGETS:
            async with engine.connect() as conn:
                with pytest.raises(DBAPIError):
                    await conn.execute(text(f"SELECT count(*) FROM {relation}"))
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_baseline_role_retains_exact_extension_catalog_visibility():
    engine = create_async_engine(dsn_for("postgres"))
    try:
        async with engine.connect() as conn:
            version = (await conn.execute(text("""
                SELECT extversion FROM pg_extension WHERE extname='timescaledb'
            """))).scalar_one()
            assert version == "2.28.2"
            for relation in TARGETS:
                assert (await conn.execute(text(
                    f"SELECT count(*) FROM {relation}"))).scalar_one() >= 0
    finally:
        await engine.dispose()
