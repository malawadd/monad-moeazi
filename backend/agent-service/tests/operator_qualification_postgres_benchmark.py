"""Opt-in disposable-schema persistence microbenchmark; never contacts external services."""
from __future__ import annotations
import asyncio, os, statistics, time
import asyncpg

URL=os.environ.get("TEST_DATABASE_URL")
if not URL: raise SystemExit("TEST_DATABASE_URL is required for the disposable local benchmark")
SCHEMA="feature17_benchmark"
async def main():
    conn=await asyncpg.connect(URL)
    try:
        await conn.execute(f"CREATE SCHEMA {SCHEMA}"); await conn.execute(f"SET search_path TO {SCHEMA},public")
        sql=open("agent-service/migrations/029_operator_qualification.sql",encoding="utf8").read().replace("BEGIN;","").replace("COMMIT;","")
        await conn.execute(sql); values=[]
        for index in range(40):
            started=time.perf_counter(); token=f"{index:064x}"
            await conn.execute("INSERT INTO operator_qualification_scopes(scope_hash,operator_test_id,tenant_fingerprint,scope_id,environment,payload) VALUES($1,$2,$3,$4,'local','{}')",token,f"operator:{index}",f"tenant:{index}",f"scope:{index}")
            await conn.execute("INSERT INTO operator_qualification_request_claims(operator_test_id,idempotency_key,request_hash,scope_hash,payload) VALUES($1,$2,$3,$4,'{}')",f"operator:{index}",f"key:{index}",f"{index+40:064x}",token)
            values.append((time.perf_counter()-started)*1000)
        p95=sorted(values)[37]; print({"median_ms":statistics.median(values),"p95_ms":p95,"max_ms":max(values)})
        if p95>=100: raise SystemExit("p95 exceeds 100 ms")
    finally:
        await conn.execute(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"); await conn.close()
asyncio.run(main())
