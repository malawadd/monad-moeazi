"""Actual SQL/ASGI simulation portfolio read; identity bridge is a local fixture."""
from types import SimpleNamespace

from fastapi import FastAPI, HTTPException
import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent import finance_routes, simulation_routes
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.lifecycle_repository import SimulationLifecycleRepository
from moeazi_agent.lifecycle_simulator import simulate_order
from test_lifecycle_preparation_postgres import guarded_dsn
from test_stage3_control_processing_postgres import submitted
from test_stage3_simulation_database_role import qualification


@pytest.mark.asyncio
async def test_portfolio_route_exposes_exact_partial_exposure_and_held_capacity_without_writes(monkeypatch):
    import test_lifecycle_preparation_postgres as fixture
    original = fixture.scenario
    monkeypatch.setattr(fixture, "scenario", lambda **values: original(
        **(values | {"depth_participation_bps": 50})))
    broad = create_async_engine(guarded_dsn())
    narrow = create_async_engine(qualification()["dsn"])
    try:
        repo, run, order = await submitted(broad)
        params = {**run.scope.model_dump(), "run_id": run.run_id}
        async with broad.begin() as conn:
            await conn.execute(text("""
                UPDATE simulation_runs SET replay_cursor_at=:cursor
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id AND run_id=:run_id
            """), {**params, "cursor": run.scenario.simulation_end_at})
        await repo.fold_order_events(run.scope, run.run_id, order,
            worker_id="stage2-verifier", command_id="portfolio-partial-fill")
        restricted = SimulationLifecycleRepository(FinanceRepository(narrow), simulator=simulate_order)

        async def owner(subject, environment, spec):
            if (subject, environment, spec) != ("verified-owner", "experiment", run.scope.scope_id):
                raise HTTPException(status_code=404, detail="unowned")
            return run.scope

        monkeypatch.setattr(simulation_routes, "_viewer_scope", owner)
        monkeypatch.setattr(finance_routes, "get_settings", lambda: SimpleNamespace(
            worker_shared_secret=SimpleNamespace(get_secret_value=lambda: "portfolio-test")))
        app = FastAPI()
        app.include_router(simulation_routes.router)
        app.state.simulation = restricted
        # There is no Temporal client or authorizer; a review may never dispatch.
        body = {"experiment_spec_id": run.scope.scope_id, "run_id": run.run_id,
                "manifest_hash": run.manifest_hash}
        headers = {"Authorization": "Bearer portfolio-test", "X-Moeazi-Subject": "verified-owner"}
        async with narrow.connect() as conn:
            before = (await conn.execute(text("""
                SELECT revision FROM finance_accounts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), params)).scalar_one()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                    base_url="http://testserver") as client:
            url = "/v1/simulation/runs/portfolio"
            response = await client.post(url, json=body, headers=headers)
            assert response.status_code == 200, response.text
            result = response.json()
            assert result["executionQualified"] is False and result["authority"] == "simulation_only"
            view = result["portfolio"]
            assert view["authority"] == "review_only" and view["requiresFreshAdmission"]
            assert view["clockMode"] == "historical_replay"
            assert view["account"]["revision"] == str(before)
            assert view["account"]["reconciliationState"] == "unknown"
            assert view["account"]["observationOrigin"] == "recorded_fixture"
            position, = view["positions"]
            assert position["arithmetic"]["signed_quantity_units"] == "500000"
            assert position["reconciliationState"] == "awaiting_checkpoint"
            assert position["pendingObligations"] is True
            assert view["heldCapacity"] and view["heldCapacityComplete"]
            assert all(int(row["units"]) > 0 for row in view["heldCapacity"])
            assert view["protectionRecordCounts"] == {} and view["nextPosition"] is None
            page = await client.post(url, headers=headers, json={**body,
                "after_instrument": position["instrumentVersionId"],
                "after_location": position["locationId"]})
            assert page.json()["portfolio"]["positions"] == []
            assert (await client.post(url, json=body)).status_code == 401
            assert (await client.post(url, json=body,
                headers={**headers, "X-Moeazi-Subject": "foreign"})).status_code == 404
            for changed in ({"strategy_account_id": "foreign"}, {"after_instrument": "only-half"}):
                assert (await client.post(url, json={**body, **changed}, headers=headers)).status_code == 422
        async with narrow.connect() as conn:
            after = (await conn.execute(text("""
                SELECT revision FROM finance_accounts WHERE environment=:environment
                  AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
            """), params)).scalar_one()
        assert after == before
    finally:
        await narrow.dispose()
        await broad.dispose()
