"""Opt-in per-write Feature 22 persistence benchmark in a disposable schema."""
from __future__ import annotations
import asyncio, statistics, sys, time, uuid
from pathlib import Path
import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
sys.path.insert(0, "agent-service/tests")
from product_eligibility_repository_harness import ASYNC_URL, URL, artifacts
sys.path.insert(0, "agent-service/src")
from moeazi_agent.product_eligibility_storage import ProductEligibilityRepository
SCHEMA=f"feature22_benchmark_{uuid.uuid4().hex}"; WRITES,WARMUP=40,5
async def main():
 direct=URL.replace("postgresql+asyncpg://","postgresql://",1); conn=await asyncpg.connect(direct); engine=None
 try:
  await conn.execute(f'CREATE SCHEMA "{SCHEMA}"; SET search_path TO "{SCHEMA}",public'); migration=Path("agent-service/migrations/034_external_product_eligibility.sql").read_text(); await conn.execute(migration); await conn.execute(migration)
  engine=create_async_engine(ASYNC_URL,connect_args={"server_settings":{"search_path":f'"{SCHEMA}",public'}}); repo=ProductEligibilityRepository(engine); samples=[]
  for i in range(WARMUP):
   bundle,payload=artifacts(10000+i); req=bundle["request"]; await repo.persist_bundle("operator:fixture",f"warmup-{i}",req.request_hash,req.scope,bundle,payload)
  for i in range(WRITES):
   bundle,payload=artifacts(20000+i); req=bundle["request"]; started=time.perf_counter(); saved=await repo.persist_bundle("operator:fixture",f"benchmark-{i}",req.request_hash,req.scope,bundle,payload); samples.append((time.perf_counter()-started)*1000); assert saved==payload
  async with engine.connect() as check: assert await check.scalar(text("SELECT count(*) FROM product_eligibility_decisions"))==WARMUP+WRITES
  p95=statistics.quantiles(samples,n=100)[94]; print(f"product-eligibility persistence benchmark writes={WRITES} p95_ms={p95:.3f}")
  if p95>=100: raise SystemExit("product-eligibility persistence p95 exceeds 100ms")
 finally:
  if engine: await engine.dispose()
  await conn.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE'); await conn.close()
asyncio.run(main())
