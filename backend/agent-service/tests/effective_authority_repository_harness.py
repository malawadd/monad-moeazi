"""Disposable real Timescale proof for Feature 19's dedicated repository."""
import asyncio, os, uuid
from pathlib import Path
import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from moeazi_agent.effective_authority_scenarios import NOW, _request, _gate
from moeazi_agent.effective_authority_registry import required_gate_ids
from moeazi_agent.effective_authority_reducer import reduce
from moeazi_agent.effective_authority_storage import EffectiveAuthorityRepository
from moeazi_agent.effective_authority_persistence_graph import TABLES, build_persistence_graph
URL=os.environ.get("POSTGRES_DSN","postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/moeazi")
SCHEMA=f"feature19_harness_{uuid.uuid4().hex}"
def h(n): return f"{n:064x}"
def payload(n,key,request): return {"runId":f"run-{n:032x}","operatorTestId":"operator:fixture","featureId":"effective-authority-decision","scenarioId":"authority-local-all-pass","mode":"enforce","repositorySha":"a"*40,"registryVersion":"v1","registryHash":h(n+1),"controlHash":h(n+2),"fixtureHash":h(n+3),"safeEnvironment":"local","invariantVerdict":"pass","idempotencyKey":key,"requestHash":request,"events":[{"sequence":1,"eventType":"run_frozen"}]}
def artifacts():
    request=_request(True); gates=tuple(_gate(x,request,i+1) for i,x in enumerate(required_gate_ids()))
    decision=reduce(request,gates,"Autopilot",NOW)
    return request,{"gates":gates,"decision":decision,"graph":build_persistence_graph(request,gates,decision,h(900))}
async def count(conn,table): return (await conn.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one()
async def main():
    direct=URL.replace("postgresql+asyncpg://","postgresql://",1); conn=await asyncpg.connect(direct); engine=None
    try:
        await conn.execute(f'CREATE SCHEMA "{SCHEMA}"; SET search_path TO "{SCHEMA}",public')
        await conn.execute("CREATE TABLE agent_test_center_runs(run_id text PRIMARY KEY,operator_test_id text NOT NULL,feature_id text NOT NULL,scenario_id text NOT NULL,mode text NOT NULL,repository_sha text NOT NULL,registry_version text NOT NULL,registry_hash char(64) NOT NULL,control_hash char(64) NOT NULL,fixture_hash char(64) NOT NULL,safe_environment text NOT NULL,invariant_verdict text NOT NULL,idempotency_key text NOT NULL,request_hash char(64) NOT NULL,payload jsonb NOT NULL,UNIQUE(operator_test_id,idempotency_key)); CREATE TABLE agent_test_center_events(event_id text PRIMARY KEY,run_id text NOT NULL REFERENCES agent_test_center_runs(run_id),feature_id text NOT NULL,sequence integer NOT NULL,event_type text NOT NULL,payload jsonb NOT NULL,UNIQUE(run_id,sequence));")
        migration=Path("agent-service/migrations/031_effective_authority_decision.sql").read_text(); await conn.execute(migration); await conn.execute(migration)
        engine=create_async_engine(URL,connect_args={"server_settings":{"search_path":f'"{SCHEMA}",public'}}); repo=EffectiveAuthorityRepository(engine); request,items=artifacts(); first=await repo.persist_bundle("operator:fixture","retry",h(1),request.scope,items,payload(1,"retry",h(1))); second=await repo.persist_bundle("operator:fixture","retry",h(1),request.scope,items,payload(2,"retry",h(1)))
        assert first==second
        async with engine.connect() as check:
            assert [await count(check,x) for x in ("effective_authority_request_claims","agent_test_center_runs","agent_test_center_events","effective_authority_gate_results","effective_authority_decisions","effective_authority_test_center_bundles")]==[1,1,1,len(required_gate_ids()),1,1]
            for table in TABLES: assert await count(check,table)==1
            assert await check.scalar(text("SELECT count(*) FROM effective_authority_current_fixture_projection"))==1
        try: await repo.persist_bundle("operator:fixture","retry",h(2),request.scope,items,payload(3,"retry",h(2)))
        except RuntimeError: pass
        else: raise AssertionError("conflict accepted")
        async with engine.connect() as check: assert await count(check,"effective_authority_conflicts")==1
        try: await repo.persist_bundle("operator:fixture","rollback",h(3),request.scope,items,payload(4,"rollback",h(3)),"x")
        except RuntimeError: pass
        else: raise AssertionError("failure accepted")
        async with engine.connect() as check: assert await count(check,"agent_test_center_runs")==1 and await check.scalar(text("SELECT count(*) FROM effective_authority_current_fixture_projection"))==1
        print("effective authority Timescale repository harness: pass")
    finally:
        if engine: await engine.dispose()
        await conn.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE'); await conn.close()
if __name__ == "__main__": asyncio.run(main())
