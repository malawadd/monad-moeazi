"""50-write disposable-schema benchmark; requires POSTGRES_DSN inside local Compose."""
import asyncio, os, statistics, time, uuid
from pathlib import Path
if not os.environ.get("POSTGRES_DSN"): raise SystemExit("POSTGRES_DSN is required")
async def main():
    from effective_authority_repository_harness import artifacts, payload, URL
    import asyncpg
    from sqlalchemy.ext.asyncio import create_async_engine
    from moeazi_agent.effective_authority_storage import EffectiveAuthorityRepository
    schema=f"feature19_benchmark_{uuid.uuid4().hex}"; direct=URL.replace("postgresql+asyncpg://","postgresql://",1); conn=await asyncpg.connect(direct); engine=None
    try:
        await conn.execute(f'CREATE SCHEMA "{schema}"; SET search_path TO "{schema}",public')
        await conn.execute("CREATE TABLE agent_test_center_runs(run_id text PRIMARY KEY,operator_test_id text,feature_id text,scenario_id text,mode text,repository_sha text,registry_version text,registry_hash char(64),control_hash char(64),fixture_hash char(64),safe_environment text,invariant_verdict text,idempotency_key text,request_hash char(64),payload jsonb,UNIQUE(operator_test_id,idempotency_key)); CREATE TABLE agent_test_center_events(event_id text PRIMARY KEY,run_id text,feature_id text,sequence integer,event_type text,payload jsonb,UNIQUE(run_id,sequence));")
        migration=Path(__file__).resolve().parents[1] / "migrations" / "031_effective_authority_decision.sql"
        await conn.execute(migration.read_text()); engine=create_async_engine(URL,connect_args={"server_settings":{"search_path":f'"{schema}",public'}}); repo=EffectiveAuthorityRepository(engine); request,items=artifacts(); samples=[]
        for n in range(50):
            now=time.perf_counter(); await repo.persist_bundle(f"operator:{n}",f"key:{n}",f"{n+100:064x}",request.scope,items,payload(n,f"key:{n}",f"{n+100:064x}")); samples.append((time.perf_counter()-now)*1000)
        p95=sorted(samples)[47]; print({"writes":50,"median_ms":round(statistics.median(samples),3),"p95_ms":round(p95,3),"max_ms":round(max(samples),3)})
        if p95>=100: raise SystemExit("p95 exceeds 100ms")
    finally:
        if engine: await engine.dispose()
        await conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'); await conn.close()
asyncio.run(main())
