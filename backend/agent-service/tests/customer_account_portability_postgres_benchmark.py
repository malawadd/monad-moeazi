"""40 individually timed real first writes in a disposable local PostgreSQL schema."""
import asyncio, statistics, time, uuid
from pathlib import Path
import asyncpg
from sqlalchemy.ext.asyncio import create_async_engine
from customer_account_portability_repository_harness import URL, run_payload
from moeazi_agent.portability_evaluator import evaluate
from moeazi_agent.portability_storage import PortabilityRepository
SCHEMA=f"feature24_benchmark_{uuid.uuid4().hex}"; H="a"*64
async def main():
 direct=URL.replace("postgresql+asyncpg://","postgresql://",1); conn=await asyncpg.connect(direct); engine=None
 try:
  await conn.execute(f'CREATE SCHEMA "{SCHEMA}"; SET search_path TO "{SCHEMA}",public')
  await conn.execute("CREATE TABLE agent_test_center_runs(run_id text PRIMARY KEY,operator_test_id text NOT NULL,feature_id text NOT NULL,scenario_id text NOT NULL,mode text NOT NULL,repository_sha text NOT NULL,registry_version text NOT NULL,registry_hash char(64) NOT NULL,control_hash char(64) NOT NULL,fixture_hash char(64) NOT NULL,safe_environment text NOT NULL,invariant_verdict text NOT NULL,idempotency_key text NOT NULL,request_hash char(64) NOT NULL,payload jsonb NOT NULL,UNIQUE(operator_test_id,idempotency_key)); CREATE TABLE agent_test_center_events(event_id text PRIMARY KEY,run_id text NOT NULL REFERENCES agent_test_center_runs(run_id),feature_id text NOT NULL,sequence integer NOT NULL,event_type text NOT NULL,payload jsonb NOT NULL,UNIQUE(run_id,sequence));")
  migration=Path("agent-service/migrations/036_customer_account_portability.sql").read_text(); await conn.execute(migration); await conn.execute(migration)
  engine=create_async_engine(URL,connect_args={"server_settings":{"search_path":f'"{SCHEMA}",public'}}); repo=PortabilityRepository(engine); samples=[]
  for n in range(40):
   request=f"benchmark:{n}"; graph=evaluate({"id":request,"request":request,"operator":f"operator:{n}"},"enforce"); started=time.perf_counter_ns()
   await repo.persist_bundle(f"operator:{n}",f"benchmark-key-{n}",f"{n:064x}",graph,run_payload(1000+n,f"benchmark-key-{n}",f"{n:064x}")); samples.append((time.perf_counter_ns()-started)/1_000_000)
  result={"writes":40,"median_ms":round(statistics.median(samples),3),"p95_ms":round(sorted(samples)[37],3),"max_ms":round(max(samples),3)}; print(result)
  if result["p95_ms"]>=100: raise SystemExit("feature24_p95_exceeds_100ms")
 finally:
  if engine: await engine.dispose()
  await conn.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE'); await conn.close()
if __name__=="__main__": asyncio.run(main())
