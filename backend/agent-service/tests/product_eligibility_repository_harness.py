"""Opt-in disposable PostgreSQL proof for Feature 22 atomic persistence."""
from __future__ import annotations
import asyncio, os, sys, uuid
from pathlib import Path
import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
sys.path.insert(0, "agent-service/src")
from moeazi_agent.product_eligibility_canonical import digest
from moeazi_agent.product_eligibility_scenarios import NOW, evaluate_fixture
from moeazi_agent.product_eligibility_storage import ProductEligibilityConflict, ProductEligibilityRepository

URL = os.environ.get("POSTGRES_DSN")
if not URL: raise SystemExit("POSTGRES_DSN is required for the disposable local repository harness")
ASYNC_URL = URL if "+asyncpg" in URL else URL.replace("postgresql://", "postgresql+asyncpg://", 1)
SCHEMA = f"feature22_harness_{uuid.uuid4().hex}"


def artifacts(index):
    item = evaluate_fixture("eligibility-001", "enforce", NOW, "operator:fixture", f"{index:064x}")["_artifacts"]
    request = item["request"]
    body = request.model_dump(exclude={"request_hash", "idempotency_hash"}, mode="python")
    body["idempotency_hash"] = digest({"write": index}); request = request.__class__(**body, request_hash=digest(body))
    decision = item["decision"]
    body = decision.model_dump(exclude={"decision_hash", "request_hash"}, mode="python") | {"request_hash": request.request_hash}
    decision = decision.__class__(**body, decision_hash=digest(body))
    return {"request": request, "decision": decision}, {"runId": f"run-{index:032x}", "fixtureHash": digest({"write": index})}


async def main():
    direct = URL.replace("postgresql+asyncpg://", "postgresql://", 1); conn = await asyncpg.connect(direct); engine = None
    try:
        await conn.execute(f'CREATE SCHEMA "{SCHEMA}"; SET search_path TO "{SCHEMA}",public')
        migration = Path("agent-service/migrations/034_external_product_eligibility.sql").read_text(); await conn.execute(migration); await conn.execute(migration)
        engine = create_async_engine(ASYNC_URL, connect_args={"server_settings": {"search_path": f'"{SCHEMA}",public'}}); repo = ProductEligibilityRepository(engine)
        for index in range(40):
            bundle, payload = artifacts(index); request = bundle["request"]
            saved = await repo.persist_bundle("operator:fixture", f"write-{index}", request.request_hash, request.scope, bundle, payload)
            assert saved == payload and await repo.read_decision("operator:fixture", request.scope.scope_hash, bundle["decision"].decision_hash)
        bundle, payload = artifacts(41); request = bundle["request"]
        for point in ("after_request", "after_decision", "after_bundle"):
            try: await repo.persist_bundle("operator:fixture", point, request.request_hash, request.scope, bundle, payload, point)
            except RuntimeError: pass
            else: raise AssertionError("failpoint accepted")
        async with engine.connect() as check: assert await check.scalar(text("SELECT count(*) FROM product_eligibility_decisions")) == 40
        bundle, payload = artifacts(42); request = bundle["request"]
        rows = await asyncio.gather(*[repo.persist_bundle("operator:fixture", "race", request.request_hash, request.scope, bundle, payload) for _ in range(8)])
        assert all(item == payload for item in rows)
        try: await repo.persist_bundle("operator:fixture", "race", digest("changed"), request.scope, bundle, payload)
        except ProductEligibilityConflict: pass
        else: raise AssertionError("changed retry accepted")
        print("product eligibility Timescale repository harness: 40 writes, rollback, readback, race: pass")
    finally:
        if engine: await engine.dispose()
        await conn.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE'); await conn.close()


if __name__ == "__main__": asyncio.run(main())
