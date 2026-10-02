"""Disposable in-container proof for Feature 18's real async repository."""
from __future__ import annotations
import asyncio, os, uuid
from pathlib import Path
import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from moeazi_agent.mandate_policy_storage import TimescaleMandatePolicyRepository

URL=os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_DSN")
if not URL: raise SystemExit("DATABASE_URL or POSTGRES_DSN is required")
SCHEMA=f"feature18_harness_{uuid.uuid4().hex}"
def direct_url(): return URL.replace("postgresql+asyncpg://","postgresql://",1)
def h(value: int): return f"{value:064x}"
async def count(conn, table, where="TRUE", **values):
    return (await conn.execute(text(f"SELECT count(*) FROM {table} WHERE {where}"),values)).scalar_one()
def payload(index: int, key: str, request: str):
    return {"runId":f"run-{index:032x}","operatorTestId":"operator:fixture","featureId":"mandate-policy-semantic-fidelity","scenarioId":"initial-activation","mode":"enforce","repositorySha":"a"*40,"registryVersion":"registry-v1","registryHash":h(21),"controlHash":h(22),"fixtureHash":h(23),"safeEnvironment":"local","invariantVerdict":"pass","idempotencyKey":key,"requestHash":request,"events":[{"sequence":1,"eventType":"run_frozen"},{"sequence":2,"eventType":"invariants_evaluated"}]}
def scope(index=1): return {"scopeHash":h(index),"tenantFingerprint":f"tenant:{index}","userFingerprint":f"user:{index}","accountFingerprint":f"account:{index}","environment":"local"}
def artifacts(index: int, *, predecessor=None, sequence=1):
    activation={"artifactHash":h(index+4),"activationHash":h(index+4),"predecessorHash":predecessor,"sequence":sequence,"result":"simulated_activated"}
    return {"mandate_policy_compilations":{"artifactHash":h(index+1),"policyHash":h(index+1)},"mandate_policy_semantic_diffs":{"artifactHash":h(index+2),"diffHash":h(index+2)},"mandate_policy_consent_receipts":{"artifactHash":h(index+3),"challengeNonceHash":h(index+3)},"mandate_policy_activation_receipts":activation,"mandate_policy_history_append_receipts":{"artifactHash":h(index+5),"historyAppendHash":h(index+5)}}
async def main():
    conn=await asyncpg.connect(direct_url()); engine=None
    try:
        await conn.execute(f'CREATE SCHEMA "{SCHEMA}"; SET search_path TO "{SCHEMA}",public')
        await conn.execute("CREATE TABLE agent_test_center_runs(run_id text PRIMARY KEY,operator_test_id text NOT NULL,feature_id text NOT NULL,scenario_id text NOT NULL,mode text NOT NULL,repository_sha text NOT NULL,registry_version text NOT NULL,registry_hash char(64) NOT NULL,control_hash char(64) NOT NULL,fixture_hash char(64) NOT NULL,safe_environment text NOT NULL,invariant_verdict text NOT NULL,idempotency_key text NOT NULL,request_hash char(64) NOT NULL,payload jsonb NOT NULL,UNIQUE(operator_test_id,idempotency_key)); CREATE TABLE agent_test_center_events(event_id text PRIMARY KEY,run_id text NOT NULL REFERENCES agent_test_center_runs(run_id),feature_id text NOT NULL,sequence integer NOT NULL,event_type text NOT NULL,payload jsonb NOT NULL,UNIQUE(run_id,sequence));")
        await conn.execute("INSERT INTO agent_test_center_runs VALUES('legacy16','operator:legacy','execution-artifact-certification','fixture','observe','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','legacy-v1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','local','pass','legacy16','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}'); INSERT INTO agent_test_center_runs VALUES('legacy17','operator:legacy','operator-qualification','fixture','observe','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','legacy-v1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','local','pass','legacy17','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','{}');")
        migration=Path("/tmp/030_mandate_policy_semantic_fidelity.sql").read_text(); await conn.execute(migration); await conn.execute(migration)
        assert await conn.fetchval("SELECT count(*) FROM agent_test_center_runs WHERE run_id IN ('legacy16','legacy17')") == 2
        await conn.execute("INSERT INTO mandate_policy_scopes(scope_hash,operator_test_id,tenant_fingerprint,user_fingerprint,account_fingerprint,environment,payload) VALUES($1,'other','tenant:other','user:other','account:other','local','{}')",h(99))
        try: await conn.execute("INSERT INTO mandate_policy_artifact_links VALUES($1,$2,$3,$4,'mapping',now())",h(1),h(50),h(99),h(51))
        except asyncpg.PostgresError: pass
        else: raise AssertionError("cross-scope link accepted")
        try: await conn.execute("UPDATE mandate_policy_scopes SET payload='{}'")
        except asyncpg.PostgresError: pass
        else: raise AssertionError("append-only update accepted")
        engine=create_async_engine(URL,connect_args={"server_settings":{"search_path":f'"{SCHEMA}",public'}})
        repo=TimescaleMandatePolicyRepository(engine); first=await repo.persist_bundle(scope(),artifacts(100),payload(1,"retry",h(30)))
        assert first==await repo.persist_bundle(scope(),artifacts(100),payload(1,"retry",h(30)))
        async with engine.connect() as check:
            assert await count(check,"mandate_policy_request_claims","operator_test_id=:o",o="operator:fixture")==1
            assert await count(check,"agent_test_center_runs","operator_test_id=:o",o="operator:fixture")==1
            assert await count(check,"agent_test_center_events","run_id=:r",r=first["runId"])==2
            assert await count(check,"mandate_policy_test_center_bundles")==1
        try: await repo.persist_bundle(scope(),artifacts(100),payload(1,"retry",h(31)))
        except RuntimeError as exc: assert str(exc)=="mandate_policy_idempotency_conflict"
        else: raise AssertionError("conflicting retry accepted")
        async with engine.connect() as check: assert await count(check,"mandate_policy_conflicts")==1
        try: await repo.persist_bundle(scope(2),artifacts(200),payload(2,"failure",h(32)),fail_at="history")
        except RuntimeError as exc: assert str(exc)=="injected_history_failure"
        else: raise AssertionError("injected failure projected success")
        async with engine.connect() as check:
            assert await count(check,"agent_test_center_runs","operator_test_id=:o",o="operator:fixture")==1
            assert await count(check,"mandate_policy_request_claims","idempotency_key=:k",k="failure")==0
        try: await repo.persist_bundle(scope(),artifacts(300,predecessor=h(999)),payload(3,"fork",h(33)))
        except RuntimeError as exc: assert str(exc)=="activation_fork"
        else: raise AssertionError("fork accepted")
        try: await conn.execute("DELETE FROM mandate_policy_request_claims")
        except asyncpg.PostgresError: pass
        else: raise AssertionError("append-only delete accepted")
        print("mandate policy Timescale repository harness: pass")
    finally:
        if engine: await engine.dispose()
        await conn.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE'); await conn.close()
asyncio.run(main())
