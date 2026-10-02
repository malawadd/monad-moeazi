"""Read-only experiment observation catalog route contracts."""
import os
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent import finance_routes, simulation_observation_catalog as catalog
from moeazi_agent.simulation_routes import router
from test_stage2_finance_postgres_sizing import setup_spot_account


HEADERS = {"Authorization": "Bearer route-test", "X-Moeazi-Subject": "alice"}
REQUEST = {"experiment_spec_id": "experiment-a", "instrument_version_id": "hl:BTC", "limit": 1}
NOW = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)


class Result:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def all(self):
        return self.rows


class Connection:
    def __init__(self, rows, calls):
        self.rows, self.calls = rows, calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def execute(self, query, params):
        sql = str(query)
        assert "raw_payload" not in sql and "normalized_body" not in sql
        assert "source_kind = 'recorded_native'" in sql
        assert "source_rights_ref = 'internal_qualification_only'" in sql
        self.calls.append(params)
        return Result(self.rows)


class Engine:
    def __init__(self, rows):
        self.rows, self.calls = rows, []

    def connect(self):
        return Connection(self.rows, self.calls)


def _row(number):
    return {"observation_hash": str(number) * 64, "instrument_version_id": "hl:BTC",
            "source_kind": "recorded_native", "source_rights_ref": "internal_qualification_only",
            "observation_kind": "book_snapshot", "event_at": NOW,
            "available_at": NOW, "received_at": NOW}


def setup(monkeypatch, rows=None):
    scopes = []

    async def owner(subject, environment, experiment_spec_id):
        scopes.append((subject, environment, experiment_spec_id))
        if experiment_spec_id != "experiment-a":
            raise HTTPException(status_code=404, detail="unowned")
        return SimpleNamespace(environment=environment, scope_id=experiment_spec_id)

    monkeypatch.setattr(finance_routes, "get_settings", lambda: SimpleNamespace(
        worker_shared_secret=SimpleNamespace(get_secret_value=lambda: "route-test")))
    monkeypatch.setattr(catalog, "_viewer_scope", owner)
    engine = Engine(rows if rows is not None else [_row("a"), _row("b")])
    app = FastAPI()
    app.include_router(router)
    app.state.finance = SimpleNamespace(engine=engine)
    return TestClient(app), engine, scopes


def test_owned_catalog_is_bounded_ordered_and_returns_metadata_only(monkeypatch):
    http, engine, scopes = setup(monkeypatch)
    response = http.post("/v1/simulation/observations/catalog", headers=HEADERS, json=REQUEST)
    assert response.status_code == 200, response.text
    body = response.json()
    assert scopes == [("alice", "experiment", "experiment-a")]
    assert engine.calls == [{"instrument": "hl:BTC", "row_limit": 2}]
    assert body["observations"] == [{
        "observationHash": "a" * 64, "instrumentVersionId": "hl:BTC",
        "sourceKind": "recorded_native", "sourceRightsRef": "internal_qualification_only",
        "observationKind": "book_snapshot", "eventAt": NOW.isoformat(),
        "availableAt": NOW.isoformat(), "receivedAt": NOW.isoformat(),
    }]
    assert body["truncated"] is True
    assert body["authority"] == "simulation_only" and body["executionQualified"] is False
    assert "rawPayloadRef" not in response.text and "normalizedBody" not in response.text


def test_untrusted_foreign_and_invalid_requests_do_not_query(monkeypatch):
    http, engine, scopes = setup(monkeypatch)
    assert http.post("/v1/simulation/observations/catalog", json=REQUEST).status_code == 401
    foreign = http.post("/v1/simulation/observations/catalog", headers=HEADERS,
                        json={**REQUEST, "experiment_spec_id": "experiment-b"})
    assert foreign.status_code == 404
    assert http.post("/v1/simulation/observations/catalog", headers=HEADERS,
                     json={**REQUEST, "unexpected": True}).status_code == 422
    assert http.post("/v1/simulation/observations/catalog", headers=HEADERS,
                     json={**REQUEST, "limit": 101}).status_code == 422
    assert engine.calls == []
    assert scopes == [("alice", "experiment", "experiment-b")]


def test_catalog_returns_empty_when_no_admitted_native_observations(monkeypatch):
    http, engine, _ = setup(monkeypatch, rows=[])
    response = http.post("/v1/simulation/observations/catalog", headers=HEADERS,
                         json={"experiment_spec_id": "experiment-a"})
    assert response.status_code == 200
    assert response.json()["observations"] == []
    assert response.json()["truncated"] is False
    assert engine.calls == [{"instrument": None, "row_limit": 51}]


@pytest.mark.asyncio
async def test_real_sql_catalog_reads_an_admitted_native_observation():
    raw = os.getenv("MOEAZI_Q4_POSTGRES_DSN")
    if not raw:
        pytest.skip("explicit disposable Q4 database opt-in required")
    url = make_url(raw)
    if (url.drivername, url.host, url.port, url.database) != (
            "postgresql+asyncpg", "127.0.0.1", 15432, "moeazi_q4_20260930"):
        raise RuntimeError("Only root's disposable loopback Q4 database is permitted")
    engine = create_async_engine(raw)
    try:
        _, _, _, instrument, _, evidence, _, _ = await setup_spot_account(
            engine, uuid4().hex)
        rows, truncated = await catalog._observations(engine,
            catalog.ObservationCatalogRequest(experiment_spec_id="q4-read-check",
                instrument_version_id=instrument.instrument_version_id, limit=10))
        assert truncated is False and len(rows) == 1
        assert rows[0]["observationHash"] == evidence.accepted_observation_hashes[0]
        assert rows[0]["instrumentVersionId"] == instrument.instrument_version_id
        assert rows[0]["sourceKind"] == "recorded_native"
        assert rows[0]["sourceRightsRef"] == "internal_qualification_only"
    finally:
        await engine.dispose()
