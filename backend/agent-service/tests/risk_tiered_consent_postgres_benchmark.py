"""Opt-in 40-write Feature 20 repository benchmark; setup is excluded."""
from __future__ import annotations
import asyncio, os, statistics, time, uuid

URL=os.environ.get("POSTGRES_DSN") or os.environ.get("TEST_DATABASE_URL")
if not URL: raise SystemExit("POSTGRES_DSN or TEST_DATABASE_URL is required")

async def main():
    from sqlalchemy.ext.asyncio import create_async_engine
    from moeazi_agent.risk_tiered_consent_storage import RiskTieredConsentRepository
    from risk_tiered_consent_repository_harness import DDL, OPERATOR, bundle, direct_url, engine_url, h, payload
    import asyncpg
    from pathlib import Path
    schema=f"feature20_benchmark_{uuid.uuid4().hex}"; setup=await asyncpg.connect(direct_url()); engine=None
    try:
        await setup.execute(f'CREATE SCHEMA "{schema}"; SET search_path TO "{schema}",public; {DDL}')
        migration=Path(__file__).resolve().parents[1]/"migrations"/"032_risk_tiered_approval_consent.sql"
        await setup.execute(migration.read_text()); await setup.execute(migration.read_text())
        engine=create_async_engine(engine_url(),connect_args={"server_settings":{"search_path":f'"{schema}",public'}}); repo=RiskTieredConsentRepository(engine); samples=[]
        for index in range(40):
            started=time.perf_counter(); await repo.persist_bundle(OPERATOR,f"key-{index}",h(index+100),bundle(index+100,f"bench-{index}"),payload(index+100,f"key-{index}",h(index+100))); samples.append((time.perf_counter()-started)*1000)
        p95=sorted(samples)[37]; summary={"writes":40,"median_ms":round(statistics.median(samples),3),"p95_ms":round(p95,3),"max_ms":round(max(samples),3)}; print(summary)
        if p95>=100: raise SystemExit("p95 exceeds 100ms")
    finally:
        if engine: await engine.dispose()
        await setup.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'); await setup.close()

if __name__=="__main__": asyncio.run(main())
