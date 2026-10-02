"""Opt-in local 40-full-bundle Timescale benchmark; no provider/network use."""
from __future__ import annotations
import asyncio, os, statistics, time, uuid
from pathlib import Path
import asyncpg
from sqlalchemy.ext.asyncio import create_async_engine
from moeazi_agent.mandate_policy_storage import TimescaleMandatePolicyRepository
URL=os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_DSN")
if not URL: raise SystemExit("TEST_DATABASE_URL is required for the disposable local benchmark")
SCHEMA=f"feature18_benchmark_{uuid.uuid4().hex}"
def direct(): return URL.replace("postgresql+asyncpg://","postgresql://",1)
def h(n): return f"{n:064x}"
def payload(n): return {"runId":f"run-{n:032x}","operatorTestId":f"operator:{n}","featureId":"mandate-policy-semantic-fidelity","scenarioId":"initial-activation","mode":"enforce","repositorySha":"a"*40,"registryVersion":"registry-v1","registryHash":h(n+10),"controlHash":h(n+20),"fixtureHash":h(n+30),"safeEnvironment":"local","invariantVerdict":"pass","idempotencyKey":f"key:{n}","requestHash":h(n+40),"events":[{"sequence":1,"eventType":"run_frozen"},{"sequence":2,"eventType":"invariants_evaluated"}]}
def scope(n): return {"scopeHash":h(n+100),"tenantFingerprint":f"tenant:{n}","userFingerprint":f"user:{n}","accountFingerprint":f"account:{n}","environment":"local"}
def artifacts(n): return {"mandate_policy_compilations":{"artifactHash":h(n+200)},"mandate_policy_semantic_diffs":{"artifactHash":h(n+300)},"mandate_policy_activation_receipts":{"artifactHash":h(n+400),"activationHash":h(n+400),"predecessorHash":None,"sequence":1,"result":"simulated_activated"}}
async def main():
    conn=await asyncpg.connect(direct()); engine=None
    try:
        await conn.execute(f'CREATE SCHEMA "{SCHEMA}"; SET search_path TO "{SCHEMA}",public')
        await conn.execute("CREATE TABLE agent_test_center_runs(run_id text PRIMARY KEY,operator_test_id text NOT NULL,feature_id text NOT NULL,scenario_id text NOT NULL,mode text NOT NULL,repository_sha text NOT NULL,registry_version text NOT NULL,registry_hash char(64) NOT NULL,control_hash char(64) NOT NULL,fixture_hash char(64) NOT NULL,safe_environment text NOT NULL,invariant_verdict text NOT NULL,idempotency_key text NOT NULL,request_hash char(64) NOT NULL,payload jsonb NOT NULL,UNIQUE(operator_test_id,idempotency_key)); CREATE TABLE agent_test_center_events(event_id text PRIMARY KEY,run_id text NOT NULL REFERENCES agent_test_center_runs(run_id),feature_id text NOT NULL,sequence integer NOT NULL,event_type text NOT NULL,payload jsonb NOT NULL,UNIQUE(run_id,sequence));")
        await conn.execute(Path("/tmp/030_mandate_policy_semantic_fidelity.sql").read_text())
        engine=create_async_engine(URL,connect_args={"server_settings":{"search_path":f'"{SCHEMA}",public'}}); repo=TimescaleMandatePolicyRepository(engine); values=[]
        for n in range(40):
            started=time.perf_counter(); await repo.persist_bundle(scope(n),artifacts(n),payload(n)); values.append((time.perf_counter()-started)*1000)
        p95=sorted(values)[37]; print({"persist_count":40,"median_ms":round(statistics.median(values),3),"p95_ms":round(p95,3),"max_ms":round(max(values),3)})
        if p95>=100: raise SystemExit("p95 exceeds 100 ms")
    finally:
        if engine: await engine.dispose()
        await conn.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE'); await conn.close()
asyncio.run(main())
