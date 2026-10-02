"""Opt-in container proof of real Feature 17 repository retry/conflict persistence."""
from __future__ import annotations
import asyncio, json, os, uuid
from datetime import datetime, timezone
from pathlib import Path
import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from moeazi_agent.operator_qualification_scenarios import evaluate_fixture
from moeazi_agent.operator_qualification_storage import OperatorQualificationRepository

URL=os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_DSN")
if not URL: raise SystemExit("DATABASE_URL or POSTGRES_DSN is required")
SCHEMA=f"feature17_repository_harness_{uuid.uuid4().hex}"
DDL="""CREATE TABLE agent_test_center_runs(run_id text PRIMARY KEY,operator_test_id text NOT NULL,feature_id text NOT NULL,scenario_id text NOT NULL,mode text NOT NULL,repository_sha text NOT NULL,registry_version text NOT NULL,registry_hash text NOT NULL,control_hash text NOT NULL,fixture_hash text NOT NULL,safe_environment text NOT NULL,invariant_verdict text NOT NULL,idempotency_key text NOT NULL,request_hash text NOT NULL,payload jsonb NOT NULL,UNIQUE(operator_test_id,idempotency_key));
CREATE TABLE agent_test_center_events(event_id text PRIMARY KEY,run_id text REFERENCES agent_test_center_runs,feature_id text,sequence integer,event_type text,payload jsonb,UNIQUE(run_id,sequence));"""

def direct_url(): return URL.replace("postgresql+asyncpg://", "postgresql://", 1)

async def main():
    setup=await asyncpg.connect(direct_url()); engine=None
    try:
        await setup.execute(f'CREATE SCHEMA "{SCHEMA}"; SET search_path TO "{SCHEMA}",public; {DDL}')
        await setup.execute(Path("/tmp/029_operator_qualification.sql").read_text())
        engine=create_async_engine(URL,connect_args={"server_settings":{"search_path":f"{SCHEMA},public"}})
        repo=OperatorQualificationRepository(engine); now=datetime(2026,1,1,tzinfo=timezone.utc)
        result=evaluate_fixture("qualification-pass-independent-review","observe",now,"operator:test","a"*64); artifacts=result.pop("_artifacts")
        payload={"runId":"run-"+"a"*32,"operatorTestId":"operator:test","featureId":"operator-qualification","scenarioId":"qualification-pass-independent-review","mode":"observe","repositorySha":"a"*40,"registryVersion":"registry:fixture","registryHash":"b"*64,"controlHash":"c"*64,"fixtureHash":result["fixtureHash"],"safeEnvironment":"local","invariantVerdict":"pass","idempotencyKey":"key:retry","requestHash":"d"*64,"events":[{"sequence":1,"eventType":"run_frozen","status":"complete"}]}
        first=await repo.persist_bundle(artifacts,payload); second=await repo.persist_bundle(artifacts,payload)
        assert first["runId"]==second["runId"]==payload["runId"]
        try: await repo.persist_bundle(artifacts,{**payload,"requestHash":"e"*64})
        except RuntimeError as exc: assert "conflict" in str(exc)
        else: raise AssertionError("mismatched retry was accepted")
        async with engine.connect() as conn:
            for table in ("operator_qualification_request_claims","operator_qualification_test_center_bundles","agent_test_center_runs","operator_qualification_conflicts"):
                assert await conn.scalar(text(f"SELECT count(*) FROM {table}"))==1
        claim=await setup.fetchrow("SELECT request_hash,scope_hash FROM operator_qualification_request_claims")
        conflict=await setup.fetchrow("SELECT scope_hash,payload FROM operator_qualification_conflicts")
        body=json.loads(conflict["payload"])
        assert claim["request_hash"]=="d"*64 and claim["scope_hash"]==artifacts["scope"].scope_hash
        assert conflict["scope_hash"]==artifacts["scope"].scope_hash and body["request_hash"]=="e"*64
        assert body["idempotency_key"]==payload["idempotencyKey"]
        for statement in ("UPDATE operator_qualification_conflicts SET payload='{}'", "DELETE FROM operator_qualification_conflicts"):
            try: await setup.execute(statement)
            except asyncpg.PostgresError: pass
            else: raise AssertionError("immutable conflict mutation was accepted")
        print("operator qualification repository harness: pass")
    finally:
        if engine: await engine.dispose()
        await setup.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')
        await setup.close()

asyncio.run(main())
