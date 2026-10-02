"""Actual SQL approval journey through ASGI; identity and wake are local fixtures."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import FastAPI, HTTPException
import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent import finance_routes, simulation_routes
from test_lifecycle_preparation_postgres import guarded_dsn, setup


@pytest.mark.asyncio
async def test_http_review_approve_revoke_reaches_actual_scoped_sql(monkeypatch):
    engine = create_async_engine(guarded_dsn())
    try:
        repo, _, run, intent, reserved = await setup(engine)
        await repo.persist_intent(intent)
        prepared = await repo.prepare_order(intent, reserved["reservationId"], 1,
            worker_id="stage2-verifier", command_id="http-prepare")

        async def scope_for(subject, environment, spec):
            if (subject, environment, spec) != ("verified-owner", "experiment", run.scope.scope_id):
                raise HTTPException(status_code=404, detail="unowned test scope")
            return run.scope

        async def unavailable(*args, **kwargs):
            raise ConnectionError("fixture wake unavailable")

        monkeypatch.setattr(finance_routes, "get_settings", lambda: SimpleNamespace(
            worker_shared_secret=SimpleNamespace(get_secret_value=lambda: "http-postgres-test")))
        monkeypatch.setattr(simulation_routes, "_viewer_scope", scope_for)
        app = FastAPI()
        app.include_router(simulation_routes.router)
        app.state.simulation = repo
        app.state.temporal = SimpleNamespace(start_workflow=unavailable)
        lookup = {"experiment_spec_id": run.scope.scope_id, "run_id": run.run_id,
                  "manifest_hash": run.manifest_hash}
        headers = {"Authorization": "Bearer http-postgres-test", "X-Moeazi-Subject": "verified-owner"}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://testserver", headers=headers) as client:
            review = await client.post("/v1/simulation/runs/prepared-orders", json=lookup)
            assert review.status_code == 200
            exact = review.json()["review"]["items"][0]
            assert exact["normalizedPayloadHash"] == prepared["normalizedPayloadHash"]
            body = {**lookup, "intent_id": intent.intent_id,
                    "normalized_payload_hash": exact["normalizedPayloadHash"],
                    "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=45)).isoformat(),
                    "command_id": "http-approve"}
            approval = await client.post("/v1/simulation/runs/approve", json=body)
            assert approval.status_code == 200, approval.text
            assert approval.json()["supervisor"]["status"] == "retry_required"
            receipt = approval.json()["approval"]["approvalReceiptHash"]
            recovered = await client.post("/v1/simulation/runs/prepared-orders", json=lookup)
            assert recovered.json()["review"]["items"][0]["approval"]["receiptHash"] == receipt
            assert recovered.json()["review"]["items"][0]["approval"]["state"] == "active"
            duplicate = await client.post("/v1/simulation/runs/approve", json=body)
            assert duplicate.json()["approval"]["approvalReceiptHash"] == receipt
            assert duplicate.json()["approval"]["status"] == "duplicate"
            revoked = await client.post("/v1/simulation/runs/revoke-approval",
                                        json={**lookup, "approval_hash": receipt})
            assert revoked.status_code == 200
            reviewed = await client.post("/v1/simulation/runs/prepared-orders", json=lookup)
            assert reviewed.json()["review"]["items"][0]["approval"]["state"] == "revoked"
            foreign = await client.post("/v1/simulation/runs/prepared-orders", json=lookup,
                                        headers={**headers, "X-Moeazi-Subject": "other"})
            assert foreign.status_code == 404
        async with engine.connect() as conn:
            params = {**run.scope.model_dump(), "run": run.run_id}
            for table in ("simulation_approval_receipts", "simulation_approval_revocations"):
                count = (await conn.execute(text(f"SELECT count(*) FROM {table} "
                    "WHERE environment=:environment AND scope_id=:scope_id "
                    "AND strategy_account_id=:strategy_account_id AND run_id=:run"), params)).scalar_one()
                assert count == 1
            orders = (await conn.execute(text("SELECT count(*) FROM simulation_orders "
                "WHERE environment=:environment AND scope_id=:scope_id "
                "AND strategy_account_id=:strategy_account_id AND run_id=:run"), params)).scalar_one()
            assert orders == 0  # Persisted approval is not a dispatched/filled order.
    finally:
        await engine.dispose()
