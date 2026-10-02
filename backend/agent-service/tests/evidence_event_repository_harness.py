"""Disposable-schema repository verification; never targets shared tables."""
from __future__ import annotations
import asyncio,os,pathlib,time
import asyncpg
from sqlalchemy.ext.asyncio import create_async_engine
from moeazi_agent.evidence_event_evaluator import evaluate
from moeazi_agent.evidence_event_storage import EvidenceEventRepository,EvidenceEventConflict,FAILPOINTS
NOW="2026-09-01T00:00:00Z"; OP="operator:repository"
def graph(number=0): return evaluate({"operation":"inspect","timeline":[{"source":"market-data","sourceEventId":f"event-{number}","eventAt":NOW,"observedAt":NOW,"receivedAt":NOW,"body":{"value":number}}]},"observe",NOW,OP,f"{number:064x}")
def payload(number=0): return {"runId":f"run-{number:032x}","operatorTestId":OP,"featureId":"evidence-event-fabric","scenarioId":"fixture","mode":"observe","repositorySha":"a"*40,"registryVersion":"local","registryHash":"a"*64,"controlHash":"b"*64,"fixtureHash":"c"*64,"safeEnvironment":"local","invariantVerdict":"pass","idempotencyKey":f"key-{number}","requestHash":f"{number:064x}","result":{"fixtureOnly":True},"events":[]}
async def main():
 dsn=os.environ["POSTGRES_DSN"].replace("postgresql+asyncpg://","postgresql://"); schema="feature25_repository_probe"; conn=await asyncpg.connect(dsn)
 await conn.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE; CREATE SCHEMA {schema}; SET search_path TO {schema}")
 await conn.execute("CREATE TABLE agent_test_center_runs(run_id text PRIMARY KEY,operator_test_id text NOT NULL,feature_id text NOT NULL,scenario_id text NOT NULL,mode text NOT NULL,repository_sha text NOT NULL,registry_version text NOT NULL,registry_hash char(64) NOT NULL,control_hash char(64) NOT NULL,fixture_hash char(64) NOT NULL,safe_environment text NOT NULL,invariant_verdict text NOT NULL,idempotency_key text NOT NULL,request_hash char(64) NOT NULL,payload jsonb NOT NULL,UNIQUE(operator_test_id,idempotency_key)); CREATE TABLE agent_test_center_events(event_id text PRIMARY KEY,run_id text NOT NULL REFERENCES agent_test_center_runs(run_id),feature_id text NOT NULL,sequence integer NOT NULL,event_type text NOT NULL,payload jsonb NOT NULL,UNIQUE(run_id,sequence));")
 await conn.execute(pathlib.Path(os.environ.get("FEATURE25_MIGRATION","/workspace/migrations/037_evidence_event_fabric.sql")).read_text())
 engine=create_async_engine(os.environ["POSTGRES_DSN"],pool_size=72,max_overflow=0,connect_args={"server_settings":{"search_path":schema}}); repo=EvidenceEventRepository(engine)
 for point in FAILPOINTS:
  if point=="post_commit_response_loss": continue
  try: await repo.persist_bundle(OP,"rollback-"+point,"a"*64,graph(),payload(),point)
  except RuntimeError: pass
  async with engine.connect() as c:
   assert not await c.scalar(__import__("sqlalchemy").text("select count(*) from evidence_event_request_claims")),point
   assert not await c.scalar(__import__("sqlalchemy").text("select count(*) from agent_test_center_runs")),point
 first=await repo.persist_bundle(OP,"same","b"*64,graph(1),payload(1)); assert first["runId"]==payload(1)["runId"]
 assert (await repo.persist_bundle(OP,"same","b"*64,graph(1),payload(1)))["runId"]==first["runId"]
 try: await repo.persist_bundle(OP,"same","c"*64,graph(2),payload(2))
 except EvidenceEventConflict: pass
 else: raise AssertionError("changed request accepted")
 try: await repo.persist_bundle(OP,"postcommit","d"*64,graph(3),payload(3),"post_commit_response_loss")
 except RuntimeError: pass
 assert (await repo.persist_bundle(OP,"postcommit","d"*64,graph(3),payload(3)))["runId"]==payload(3)["runId"]
 concurrent=await asyncio.gather(*[repo.persist_bundle(OP,"concurrent","e"*64,graph(4),payload(4)) for _ in range(64)])
 assert {item["runId"] for item in concurrent}=={payload(4)["runId"]}
 semantic=await asyncio.gather(*[repo.persist_bundle(OP,f"semantic-{n}",f"{n+100:064x}",graph(5),payload(n+100)) for n in range(64)])
 assert len({item["runId"] for item in semantic})==64
 async with engine.connect() as c: assert await c.scalar(__import__("sqlalchemy").text("select count(*) from evidence_event_request_claims where operator_test_id=:o"),{"o":OP})>=67
 async with engine.begin() as c:
  q=__import__("sqlalchemy").text; row=(await c.execute(q("SELECT scope_hash FROM evidence_event_scopes WHERE operator_test_id=:o LIMIT 1"),{"o":OP})).first(); s=row[0]
  e=(await c.execute(q("SELECT event_hash FROM evidence_event_events WHERE operator_test_id=:o LIMIT 1"),{"o":OP})).first()[0]
  m=(await c.execute(q("SELECT artifact_hash FROM evidence_event_replay_manifests WHERE operator_test_id=:o LIMIT 1"),{"o":OP})).first()[0]
  t=(await c.execute(q("SELECT artifact_hash FROM evidence_event_trigger_intents WHERE operator_test_id=:o LIMIT 1"),{"o":OP})).first()[0]
  state=(await c.execute(q("SELECT artifact_hash FROM evidence_event_state_snapshots WHERE operator_test_id=:o LIMIT 1"),{"o":OP})).first()[0]
  context=(await c.execute(q("SELECT artifact_hash FROM evidence_event_feature03_contexts WHERE operator_test_id=:o LIMIT 1"),{"o":OP})).first()[0]
  probes={
   "event_orphan_scope":"INSERT INTO evidence_event_events VALUES ('foreign',repeat('f',64),repeat('1',64),'x','x',1,NULL,repeat('a',64),'{}')",
   "event_zero_revision":f"INSERT INTO evidence_event_events VALUES ('{OP}','{s}',repeat('2',64),'x','zero',0,NULL,repeat('a',64),'{{}}')",
   "event_v1_supersedes":f"INSERT INTO evidence_event_events VALUES ('{OP}','{s}',repeat('3',64),'x','prior',1,'{e}',repeat('a',64),'{{}}')",
   "event_v2_missing_prior":f"INSERT INTO evidence_event_events VALUES ('{OP}','{s}',repeat('4',64),'x','missing',2,repeat('f',64),repeat('a',64),'{{}}')",
   "event_duplicate_revision":f"INSERT INTO evidence_event_events SELECT operator_test_id,scope_hash,repeat('5',64),source_id,source_event_id,revision,supersedes_hash,repeat('a',64),'{{}}' FROM evidence_event_events WHERE event_hash='{e}'",
   "relation_self":f"INSERT INTO evidence_event_relations VALUES ('{OP}','{s}',repeat('6',64),'{e}','{e}','derives',repeat('a',64),'{{}}')",
   "relation_foreign_target":f"INSERT INTO evidence_event_relations VALUES ('{OP}','{s}',repeat('7',64),'{e}',repeat('f',64),'derives',repeat('a',64),'{{}}')",
   "relation_invalid_kind":f"INSERT INTO evidence_event_relations VALUES ('{OP}','{s}',repeat('8',64),'{e}','{e}','invalid',repeat('a',64),'{{}}')",
   "quality_foreign_event":f"INSERT INTO evidence_event_quality_assessments VALUES ('{OP}','{s}',repeat('9',64),repeat('f',64),repeat('a',64),repeat('a',64),'{{}}')",
   "quality_dimension_bad_name":f"INSERT INTO evidence_event_quality_dimensions VALUES ('{OP}','{s}',repeat('f',64),'bad','pass',repeat('a',64),'{{}}')",
   "quality_dimension_bad_status":f"INSERT INTO evidence_event_quality_dimensions VALUES ('{OP}','{s}',repeat('f',64),'authenticity','bad',repeat('a',64),'{{}}')",
   "watermark_regression":f"INSERT INTO evidence_event_watermark_transitions VALUES ('{OP}','{s}',repeat('a',64),'source',9,8,repeat('a',64),'{{}}')",
   "trigger_foreign_scope":"INSERT INTO evidence_event_trigger_intents VALUES ('foreign',repeat('f',64),repeat('a',64),repeat('a',64),repeat('a',64),'{}')",
   "trigger_member_foreign_trigger":f"INSERT INTO evidence_event_trigger_members VALUES ('{OP}','{s}',repeat('f',64),'{e}',0,repeat('a',64),'{{}}')",
   "trigger_member_foreign_event":f"INSERT INTO evidence_event_trigger_members VALUES ('{OP}','{s}','{t}',repeat('f',64),9,repeat('a',64),'{{}}')",
   "trigger_member_negative_sequence":f"INSERT INTO evidence_event_trigger_members VALUES ('{OP}','{s}','{t}','{e}',-1,repeat('a',64),'{{}}')",
   "dispatch_foreign_trigger":f"INSERT INTO evidence_event_dispatch_observations VALUES ('{OP}','{s}',repeat('a',64),repeat('f',64),repeat('a',64),'{{}}')",
   "replay_member_foreign_manifest":f"INSERT INTO evidence_event_replay_manifest_events VALUES ('{OP}','{s}',repeat('f',64),'{e}',0,repeat('a',64),'{{}}')",
   "replay_member_foreign_event":f"INSERT INTO evidence_event_replay_manifest_events VALUES ('{OP}','{s}','{m}',repeat('f',64),99,repeat('a',64),'{{}}')",
   "replay_member_negative_sequence":f"INSERT INTO evidence_event_replay_manifest_events VALUES ('{OP}','{s}','{m}','{e}',-1,repeat('a',64),'{{}}')",
   "missing_bad_state":f"INSERT INTO evidence_event_missing_sources VALUES ('{OP}','{s}','{m}','x','bad',repeat('a',64),'{{}}')",
   "missing_foreign_manifest":f"INSERT INTO evidence_event_missing_sources VALUES ('{OP}','{s}',repeat('f',64),'x','missing',repeat('a',64),'{{}}')",
   "analytical_foreign_manifest":f"INSERT INTO evidence_event_analytical_manifests VALUES ('{OP}','{s}',repeat('a',64),repeat('f',64),repeat('a',64),'{{}}')",
   "state_foreign_manifest":f"INSERT INTO evidence_event_state_snapshots VALUES ('{OP}','{s}',repeat('b',64),repeat('f',64),repeat('a',64),'{{}}')",
   "root_foreign_state":f"INSERT INTO evidence_event_roots VALUES ('{OP}','{s}',repeat('c',64),repeat('f',64),'{m}','{context}',repeat('a',64),repeat('a',64),'{{}}')",
   "root_foreign_context":f"INSERT INTO evidence_event_roots VALUES ('{OP}','{s}',repeat('d',64),'{state}','{m}',repeat('f',64),repeat('b',64),repeat('a',64),'{{}}')",
   "bundle_foreign_root":f"INSERT INTO evidence_event_test_center_bundles VALUES ('{OP}','{s}',repeat('e',64),repeat('f',64),repeat('a',64),'{{}}')",
   "request_claim_duplicate":"INSERT INTO evidence_event_request_claims VALUES ('operator:repository','same',repeat('f',64),NULL,repeat('a',64),'{}')",
  }
  probes|={f"append_only_update_{table}":f"UPDATE {table} SET payload='{{}}'" for table in ("evidence_event_scopes","evidence_event_events","evidence_event_deliveries","evidence_event_quality_assessments","evidence_event_quality_dimensions","evidence_event_trigger_intents","evidence_event_trigger_members","evidence_event_replay_manifests","evidence_event_roots","evidence_event_request_claims","evidence_event_test_center_bundles")}
  probes|={f"append_only_delete_{table}":f"DELETE FROM {table}" for table in ("evidence_event_scopes","evidence_event_events","evidence_event_deliveries","evidence_event_quality_dimensions","evidence_event_trigger_members","evidence_event_dispatch_observations","evidence_event_replay_manifest_events","evidence_event_analytical_manifests","evidence_event_state_snapshots","evidence_event_roots")}
  assert len(probes)>=48
  for name,sql in probes.items():
   try:
    async with c.begin_nested(): await c.execute(q(sql))
   except Exception: continue
   raise AssertionError(f"sql probe accepted:{name}")
  print(f"sql integrity probes={len(probes)} rejected={len(probes)}")
 samples=[]
 for n in range(50):
  start=time.perf_counter(); await repo.persist_bundle(OP,f"bench-{n}",f"{n+10:064x}",graph(n+10),payload(n+10)); samples.append((time.perf_counter()-start)*1000)
 samples.sort(); assert samples[47]<=150 and samples[-1]<=500,(samples[47],samples[-1])
 print(f"repository bundles=50 p95={samples[47]:.2f}ms max={samples[-1]:.2f}ms failpoints={len(FAILPOINTS)} concurrent=64 semantic=64")
 await engine.dispose(); await conn.execute(f"DROP SCHEMA {schema} CASCADE"); await conn.close()
if __name__=="__main__": asyncio.run(main())
