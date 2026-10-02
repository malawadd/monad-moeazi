"""Opt-in portable PostgreSQL proof for Feature 21 atomic persistence."""
from __future__ import annotations
import asyncio, os, sys, uuid
from pathlib import Path
import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
sys.path.insert(0, "agent-service/src")
from moeazi_agent.usage_rights_canonical import digest
from moeazi_agent.usage_rights_scenarios import NOW, evaluate_fixture
from moeazi_agent.usage_rights_storage import UsageRightsConflict, UsageRightsRepository

URL = os.environ.get("POSTGRES_DSN")
if not URL: raise SystemExit("POSTGRES_DSN is required for the disposable local repository harness")
ASYNC_URL = URL if "+asyncpg" in URL else URL.replace("postgresql://", "postgresql+asyncpg://", 1)
SCHEMA = f"feature21_harness_{uuid.uuid4().hex}"

def artifacts(index):
    item = evaluate_fixture("usage-rights-fetch", "enforce", NOW, "operator:fixture", f"{index:064x}")["_artifacts"]
    request = item["request"]
    body = request.model_dump(exclude={"request_hash", "idempotency_hash"}, mode="python")
    body["idempotency_hash"] = digest({"write": index})
    request = request.__class__(**body, request_hash=digest(body))
    decision = item["decision"]
    body = decision.model_dump(exclude={"decision_hash", "request_hash"}, mode="python") | {"request_hash": request.request_hash}
    decision = decision.__class__(**body, decision_hash=digest(body))
    return request, decision, {"runId": f"run-{index:032x}", "fixtureHash": digest({"write": index}), "requestHash": request.request_hash}

async def main():
    direct = URL.replace("postgresql+asyncpg://", "postgresql://", 1); conn, engine = await asyncpg.connect(direct), None
    try:
        await conn.execute(f'CREATE SCHEMA "{SCHEMA}"; SET search_path TO "{SCHEMA}",public')
        migration = Path("agent-service/migrations/033_external_usage_rights.sql").read_text()
        await conn.execute(migration); await conn.execute(migration)
        engine = create_async_engine(ASYNC_URL, connect_args={"server_settings": {"search_path": f'"{SCHEMA}",public'}}); repo = UsageRightsRepository(engine)
        for index in range(40):
            request, decision, payload = artifacts(index)
            saved = await repo.persist("operator:fixture", f"write-{index}", request.request_hash, request.scope, request, decision, payload)
            assert saved == payload and await repo.read_decision("operator:fixture", request.scope.scope_hash, decision.decision_hash) == decision.model_dump(mode="json")
        request, decision, payload = artifacts(41)
        try: await repo.persist("operator:fixture", "failure", request.request_hash, request.scope, request, decision, payload, failpoint="after_request")
        except RuntimeError as exc: assert str(exc) == "usage_rights_injected_failure"
        else: raise AssertionError("injected failure accepted")
        async with engine.connect() as check:
            assert await check.scalar(text("SELECT count(*) FROM usage_rights_decisions")) == 40
            assert await check.scalar(text("SELECT count(*) FROM usage_rights_leaf_matches")) == 40
            assert await check.scalar(text("SELECT count(*) FROM usage_rights_test_center_bundles")) == 40
        request, decision, payload = artifacts(42)
        winner = await asyncio.gather(*[repo.persist("operator:fixture", "race", request.request_hash, request.scope, request, decision, payload) for _ in range(8)])
        assert all(row == payload for row in winner)
        try: await repo.persist("operator:fixture", "race", digest("changed"), request.scope, request, decision, payload)
        except UsageRightsConflict: pass
        else: raise AssertionError("changed retry accepted")
        print("usage rights Timescale repository harness: 40 writes, rollback, readback, race: pass")
    finally:
        if engine: await engine.dispose()
        await conn.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE'); await conn.close()

if __name__ == "__main__": asyncio.run(main())
