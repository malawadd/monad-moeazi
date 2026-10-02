"""Real local PostgreSQL proof for Feature 24's append-only fixture repository."""
import asyncio, os, uuid
from pathlib import Path
import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from moeazi_agent.portability_evaluator import evaluate
from moeazi_agent.portability_storage import FAILPOINTS, PortabilityConflict, PortabilityRepository

URL=os.environ.get("POSTGRES_DSN","postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/moeazi")
SCHEMA=f"feature24_harness_{uuid.uuid4().hex}"
H="a"*64
def run_payload(n,key,request):
 return {"runId":f"run-{n:032x}","operatorTestId":"operator:fixture","featureId":"customer-account-portability","scenarioId":"p07-01","mode":"enforce","repositorySha":"b"*40,"registryVersion":"2026-09-08.feature-24-local-v1","registryHash":H,"controlHash":H,"fixtureHash":H,"safeEnvironment":"local","invariantVerdict":"pass","idempotencyKey":key,"requestHash":request,"events":[{"sequence":1,"eventType":"fixture_evaluated"}]}
async def scalar(c,sql): return await c.scalar(text(sql))
async def main():
 direct=URL.replace("postgresql+asyncpg://","postgresql://",1); conn=await asyncpg.connect(direct); engine=None
 try:
  await conn.execute(f'CREATE SCHEMA "{SCHEMA}"; SET search_path TO "{SCHEMA}",public')
  await conn.execute("CREATE TABLE agent_test_center_runs(run_id text PRIMARY KEY,operator_test_id text NOT NULL,feature_id text NOT NULL,scenario_id text NOT NULL,mode text NOT NULL,repository_sha text NOT NULL,registry_version text NOT NULL,registry_hash char(64) NOT NULL,control_hash char(64) NOT NULL,fixture_hash char(64) NOT NULL,safe_environment text NOT NULL,invariant_verdict text NOT NULL,idempotency_key text NOT NULL,request_hash char(64) NOT NULL,payload jsonb NOT NULL,UNIQUE(operator_test_id,idempotency_key)); CREATE TABLE agent_test_center_events(event_id text PRIMARY KEY,run_id text NOT NULL REFERENCES agent_test_center_runs(run_id),feature_id text NOT NULL,sequence integer NOT NULL,event_type text NOT NULL,payload jsonb NOT NULL,UNIQUE(run_id,sequence));")
  migration=Path("agent-service/migrations/036_customer_account_portability.sql").read_text(); await conn.execute(migration); await conn.execute(migration)
  await conn.execute(Path("agent-service/tests/sql/029_customer_account_portability_upgrade.sql").read_text())
  engine=create_async_engine(URL,connect_args={"server_settings":{"search_path":f'"{SCHEMA}",public'}}); repo=PortabilityRepository(engine)
  graph=evaluate({"id":"repository","request":"same","operation":"inspect_export","operator":"operator:fixture"},"enforce")
  first=await repo.persist_bundle("operator:fixture","retry-key",H,graph,run_payload(1,"retry-key",H)); assert first==await repo.persist_bundle("operator:fixture","retry-key",H,graph,run_payload(2,"retry-key",H))
  try: await repo.persist_bundle("operator:fixture","retry-key","c"*64,graph,run_payload(3,"retry-key","c"*64))
  except PortabilityConflict: pass
  else: raise AssertionError("changed_request_accepted")
  for index,point in enumerate(FAILPOINTS,10):
   item=evaluate({"id":f"fail-{index}","request":f"fail-{index}","operator":"operator:fixture"},"enforce")
   try: await repo.persist_bundle("operator:fixture",f"fail-key-{index}",f"{index:064x}",item,run_payload(index,f"fail-key-{index}",f"{index:064x}"),point)
   except RuntimeError: pass
   else: raise AssertionError(point)
   async with engine.connect() as check:
    assert await scalar(check,"SELECT count(*) FROM portability_request_claims") == 1
    assert await scalar(check,"SELECT count(*) FROM agent_test_center_runs") == 1
  item=evaluate({"id":"concurrent","request":"same","operator":"operator:concurrent"},"enforce")
  values=await asyncio.gather(*[repo.persist_bundle("operator:concurrent","concurrent-key",H,item,run_payload(100+i,"concurrent-key",H)) for i in range(32)])
  assert len({v["runId"] for v in values})==1
  async with engine.connect() as check:
   assert await scalar(check,"SELECT count(*) FROM portability_request_claims WHERE operator_test_id='operator:concurrent'")==1
   assert await scalar(check,"SELECT count(*) FROM portability_root_manifests WHERE operator_test_id='operator:concurrent'")==1
   assert await scalar(check,"SELECT count(*) FROM portability_conflicts WHERE operator_test_id='operator:fixture'")==1
  other=evaluate({"id":"isolation","request":"same","operator":"operator:other"},"enforce")
  await repo.persist_bundle("operator:other","retry-key",H,other,run_payload(200,"retry-key",H)); assert await repo.read_claim("operator:other","retry-key",H)
  async with engine.begin() as corrupt:
   await corrupt.execute(text("DROP TRIGGER portability_no_mutation ON portability_request_claims")); await corrupt.execute(text("UPDATE portability_request_claims SET payload_hash='0' || substr(payload_hash,2) WHERE operator_test_id='operator:other'"))
  try: await repo.read_claim("operator:other","retry-key",H)
  except RuntimeError as error: assert str(error)=="portability_readback_corrupt"
  else: raise AssertionError("corrupt_readback_accepted")
  print({"feature24_repository":"pass","failpoints":len(FAILPOINTS),"concurrent":32})
 finally:
  if engine: await engine.dispose()
  await conn.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE'); await conn.close()
if __name__=="__main__": asyncio.run(main())
