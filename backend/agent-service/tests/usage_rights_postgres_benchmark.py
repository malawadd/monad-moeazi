"""Opt-in per-write persistence benchmark in an independently disposable schema."""
from __future__ import annotations

import asyncio
import statistics
import time
import uuid
from pathlib import Path

import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from usage_rights_repository_harness import ASYNC_URL, URL, artifacts

import sys
sys.path.insert(0, "agent-service/src")
from moeazi_agent.usage_rights_storage import UsageRightsRepository

SCHEMA = f"feature21_benchmark_{uuid.uuid4().hex}"
WRITES, WARMUP = 40, 5


async def benchmark():
    direct = URL.replace("postgresql+asyncpg://", "postgresql://", 1)
    conn, engine = await asyncpg.connect(direct), None
    try:
        await conn.execute(f'CREATE SCHEMA "{SCHEMA}"; SET search_path TO "{SCHEMA}",public')
        migration = Path("agent-service/migrations/033_external_usage_rights.sql").read_text()
        await conn.execute(migration); await conn.execute(migration)
        engine = create_async_engine(ASYNC_URL, connect_args={"server_settings": {"search_path": f'"{SCHEMA}",public'}})
        repo, samples = UsageRightsRepository(engine), []
        for index in range(WARMUP):
            request, decision, payload = artifacts(10_000 + index)
            await repo.persist("operator:fixture", f"warmup-{index}", request.request_hash, request.scope, request, decision, payload)
        for index in range(WRITES):
            request, decision, payload = artifacts(20_000 + index)
            started = time.perf_counter()
            saved = await repo.persist("operator:fixture", f"benchmark-{index}", request.request_hash, request.scope, request, decision, payload)
            samples.append((time.perf_counter() - started) * 1000)
            assert saved == payload
            assert await repo.read_decision("operator:fixture", request.scope.scope_hash, decision.decision_hash) == decision.model_dump(mode="json")
        async with engine.connect() as check:
            assert await check.scalar(text("SELECT count(*) FROM usage_rights_decisions")) == WARMUP + WRITES
            assert await check.scalar(text("SELECT count(*) FROM usage_rights_test_center_bundles")) == WARMUP + WRITES
        p95 = statistics.quantiles(samples, n=100)[94]
        print(f"usage-rights persistence benchmark writes={WRITES} p95_ms={p95:.3f}")
        if p95 >= 100: raise SystemExit("usage-rights persistence p95 exceeds 100ms")
    finally:
        if engine: await engine.dispose()
        await conn.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE'); await conn.close()


asyncio.run(benchmark())
