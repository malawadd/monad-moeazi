"""Opt-in disposable-schema proof for Feature 20's real repository."""
from __future__ import annotations
import asyncio, os, uuid
from datetime import datetime, timezone
from pathlib import Path

URL=os.environ.get("POSTGRES_DSN") or os.environ.get("TEST_DATABASE_URL")
if not URL: raise SystemExit("POSTGRES_DSN or TEST_DATABASE_URL is required")

SCHEMA=f"feature20_harness_{uuid.uuid4().hex}"
OPERATOR="operator_"+"a"*32
NOW=datetime(2026,9,7,tzinfo=timezone.utc)
DDL="""CREATE TABLE agent_test_center_runs(run_id text PRIMARY KEY,operator_test_id text NOT NULL,feature_id text NOT NULL,scenario_id text NOT NULL,mode text NOT NULL,repository_sha text NOT NULL,registry_version text NOT NULL,registry_hash char(64) NOT NULL,control_hash char(64) NOT NULL,fixture_hash char(64) NOT NULL,safe_environment text NOT NULL,invariant_verdict text NOT NULL,idempotency_key text NOT NULL,request_hash char(64) NOT NULL,payload jsonb NOT NULL,UNIQUE(operator_test_id,idempotency_key)); CREATE TABLE agent_test_center_events(event_id text PRIMARY KEY,run_id text NOT NULL REFERENCES agent_test_center_runs(run_id),feature_id text NOT NULL,sequence integer NOT NULL,event_type text NOT NULL,payload jsonb NOT NULL,UNIQUE(run_id,sequence));"""

def h(number:int)->str: return f"{number:064x}"
def direct_url()->str: return URL.replace("postgresql+asyncpg://","postgresql://",1)
def engine_url()->str: return URL if "+asyncpg://" in URL else URL.replace("postgresql://","postgresql+asyncpg://",1)
def payload(number:int,key:str,request:str)->dict:
    return {"runId":f"run-{number:032x}","operatorTestId":OPERATOR,"featureId":"risk-tiered-approval-consent","scenarioId":"consent-ordinary-accept","mode":"enforce","repositorySha":"a"*40,"registryVersion":"fixture-v1","registryHash":h(number+1),"controlHash":h(number+2),"fixtureHash":h(number+3),"safeEnvironment":"local","invariantVerdict":"pass","idempotencyKey":key,"requestHash":request,"events":[{"sequence":1,"eventType":"run_frozen","status":"complete"}]}

def bundle(number:int,suffix:str="fixture"):
    from moeazi_agent.risk_tiered_consent_assessor import assess
    from moeazi_agent.risk_tiered_consent_canonical import digest
    from moeazi_agent.risk_tiered_consent_compare import compare
    from moeazi_agent.risk_tiered_consent_fixture_executor import FixtureConsentExecutor
    from moeazi_agent.risk_tiered_consent_nonce import validate_observation
    from moeazi_agent.risk_tiered_consent_packet import build
    from moeazi_agent.risk_tiered_consent_receipt_contracts import ApprovalConsentReceipt, SignerVerificationObservation
    from moeazi_agent.risk_tiered_consent_scenarios import _manifest, _scope
    from moeazi_agent.risk_tiered_consent_scope_contracts import ApprovalRequest
    from moeazi_agent.risk_tiered_consent_source_contracts import Feature19ContextBinding
    scope=_scope(suffix); manifest=_manifest(scope,{"mutation":"none","utilization":0}); assessment=assess(manifest,NOW)
    request=ApprovalRequest(mode="Approval",request_hash=h(number+10),idempotency_hash=h(number+11)); packet=build(scope,request,assessment,NOW)
    observation=SignerVerificationObservation(provider="particle",method="synthetic_owner_proof",expected_signer_fingerprint=scope.owner_fingerprint,observed_signer_fingerprint=scope.owner_fingerprint,packet_hash=packet.packet_hash,challenge_hash=packet.challenge_hash,verified_at=NOW,status="accepted")
    outcome=validate_observation(packet,observation,NOW); body={"packet_hash":packet.packet_hash,"challenge_hash":packet.challenge_hash,"outcome":outcome,"consumed_at":NOW}; receipt=ApprovalConsentReceipt(**body,receipt_hash=digest(body))
    executor=FixtureConsentExecutor(); assert executor.consume(outcome)=="accepted"; assert executor.persist(("graph",))=="complete"
    baseline={"route":"a","venue":"v","channel":"protected","size":10,"leverage":2,"debit":10,"output":10,"risk":10,"uncertainty":0}; comparison=compare(packet,baseline,baseline)
    context=Feature19ContextBinding(run_id="run-"+"b"*32,operator_test_id=OPERATOR,decision_hash=h(number+20),registry_hash=h(number+21),control_hash=h(number+22),request_hash=h(number+23))
    return {"scope":scope,"manifest":manifest,"assessment":assessment,"packet":packet,"receipt":receipt,"comparison":comparison,"feature19_context":context,"execution":executor}

async def count(conn,table):
    from sqlalchemy import text
    return (await conn.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one()

async def main():
    import asyncpg
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine
    from moeazi_agent.risk_tiered_consent_storage import RiskTieredConsentRepository
    setup=await asyncpg.connect(direct_url()); engine=None
    try:
        await setup.execute(f'CREATE SCHEMA "{SCHEMA}"; SET search_path TO "{SCHEMA}",public; {DDL}')
        migration=Path(__file__).resolve().parents[1]/"migrations"/"032_risk_tiered_approval_consent.sql"
        await setup.execute(migration.read_text()); await setup.execute(migration.read_text())
        engine=create_async_engine(engine_url(),connect_args={"server_settings":{"search_path":f'"{SCHEMA}",public'}}); repo=RiskTieredConsentRepository(engine)
        items=bundle(1); first=await repo.persist_bundle(OPERATOR,"retry",h(1),items,payload(1,"retry",h(1))); second=await repo.persist_bundle(OPERATOR,"retry",h(1),items,payload(2,"retry",h(1))); assert first==second
        async with engine.connect() as check:
            tables=("risk_tiered_consent_scopes","risk_tiered_consent_feature19_contexts","risk_tiered_consent_source_receipts","risk_tiered_consent_packets","risk_tiered_consent_nonce_consumptions","risk_tiered_consent_lifecycle_transitions","risk_tiered_consent_request_claims","agent_test_center_runs","agent_test_center_events")
            assert [await count(check,table) for table in tables]==[1,1,9,1,1,1,1,1,1]
            assert await check.scalar(text("SELECT count(*) FROM risk_tiered_consent_current_fixture_projection"))==1
        try: await repo.persist_bundle(OPERATOR,"retry",h(2),items,payload(3,"retry",h(2)))
        except RuntimeError as error: assert "conflict" in str(error)
        else: raise AssertionError("mismatched request accepted")
        async with engine.connect() as check: assert await count(check,"risk_tiered_consent_conflicts")==1
        try: await repo.persist_bundle(OPERATOR,"rollback",h(3),bundle(3,"rollback"),payload(4,"rollback",h(3)),True)
        except RuntimeError as error: assert "injected" in str(error)
        else: raise AssertionError("rollback injection accepted")
        async with engine.connect() as check:
            assert await count(check,"agent_test_center_runs")==1 and await check.scalar(text("SELECT count(*) FROM risk_tiered_consent_current_fixture_projection"))==1
            try: await check.execute(text("INSERT INTO risk_tiered_consent_nonce_consumptions VALUES (:o,:s,:c,:r,'rejected','{}')"),{"o":OPERATOR,"s":items["scope"].scope_hash,"c":items["receipt"].challenge_hash,"r":h(90)})
            except Exception: pass
            else: raise AssertionError("nonce reuse accepted")
        isolated=bundle(4,"isolated"); await repo.persist_bundle(OPERATOR,"isolated",h(4),isolated,payload(5,"isolated",h(4)))
        async with engine.connect() as check: assert await count(check,"risk_tiered_consent_scopes")==2 and await check.scalar(text("SELECT count(*) FROM risk_tiered_consent_current_fixture_projection"))==2
        print("risk-tiered-consent repository harness: pass")
    finally:
        if engine: await engine.dispose()
        await setup.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE'); await setup.close()

if __name__=="__main__": asyncio.run(main())
