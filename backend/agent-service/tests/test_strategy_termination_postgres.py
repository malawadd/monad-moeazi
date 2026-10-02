"""Disposable Postgres proof for Feature 14's latch-first local repository."""
import asyncio
import os
from datetime import datetime, timezone
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from moeazi_agent.strategy_termination_canonical import digest
from moeazi_agent.strategy_termination_scenarios import evaluate_fixture
from moeazi_agent.strategy_termination_storage import StrategyTerminationRepository

DSN=os.getenv("MOEAZI_TEST_POSTGRES_DSN")
pytestmark=__import__("pytest").mark.skipif(not DSN,reason="set MOEAZI_TEST_POSTGRES_DSN for disposable DB proof")
NAMES=("cross-state-recovery-continuity","intent-execution-equivalence")

def bindings():
    return {name:{"runId":f"run-{digest({'n':name})[:32]}","runHash":digest({"run":name}),"bundleHash":digest({"bundle":name}),"controlHash":digest({"control":name}),"registryHash":digest({"registry":name})} for name in NAMES}
def payload(operator, key, request):
    run=digest({"operator":operator,"key":key,"request":request})
    return {"runId":f"run-{run[:32]}","operatorTestId":operator,"featureId":"verified-strategy-termination","scenarioId":"clean-full","mode":"enforce","repositorySha":"0"*40,"registryVersion":"test","registryHash":"a"*64,"controlHash":"b"*64,"fixtureHash":"c"*64,"safeEnvironment":"test","invariantVerdict":"pass","idempotencyKey":key,"requestHash":request,"events":[{"sequence":1,"eventType":"run_frozen","status":"complete"}],"result":{"productOutcome":"unavailable"}}
def artifact(operator): return evaluate_fixture("clean-full","enforce",datetime(2026,1,1,tzinfo=timezone.utc),operator,"d"*64,prerequisites=bindings())

def test_latch_first_retry_conflict_and_immutability():
    async def run():
        engine=create_async_engine(DSN); repo=StrategyTerminationRepository(engine); operator="operator:pgproof"; value=artifact(operator); first=payload(operator,"terminate:pgproof","e"*64)
        try: await repo.persist_bundle(value,first,fail_after_latch=True)
        except RuntimeError as exc: assert "after durable latch" in str(exc)
        else: raise AssertionError("fault injection did not interrupt after latch")
        async with engine.connect() as conn:
            assert (await conn.execute(text("SELECT count(*) FROM termination_latches"))).scalar_one()==1
            assert (await conn.execute(text("SELECT count(*) FROM termination_workflow_events"))).scalar_one()==1
        saved=await repo.persist_bundle(value,first); assert saved["runId"]==first["runId"]
        assert (await repo.persist_bundle(value,first))["runId"]==first["runId"]
        changed={**first,"requestHash":"f"*64}
        try: await repo.persist_bundle(value,changed)
        except RuntimeError: pass
        else: raise AssertionError("changed request accepted")
        async with engine.connect() as conn:
            assert (await conn.execute(text("SELECT count(*) FROM termination_conflicts"))).scalar_one()==1
            try: await conn.execute(text("UPDATE termination_latches SET payload='{}'::jsonb"))
            except Exception as exc: assert "immutable" in str(exc)
            else: raise AssertionError("immutable update accepted")
        await engine.dispose()
    asyncio.run(run())
