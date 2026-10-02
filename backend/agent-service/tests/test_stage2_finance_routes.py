"""Independent Q3 read-route authority tests; Convex and Postgres are fakes."""
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from moeazi_agent import finance_routes
from moeazi_agent.finance_contracts import FinanceError


class OwnerClient:
    calls = []
    def __init__(self, _settings):
        async def close():
            return None
        self.client = SimpleNamespace(aclose=close)

    async def command(self, command, **arguments):
        assert command == "getViewerFinanceScope"
        self.calls.append(arguments)
        if arguments["subject"] != "alice":
            return None
        if arguments["environment"] == "live":
            return {"scope": {"environment": "live", "scopeId": "live",
                "strategyAccountId": "acct-a"}}
        if arguments.get("experimentSpecId") == "spec-a":
            return {"scope": {"environment": "experiment", "scopeId": "spec-a",
                "strategyAccountId": "acct-a"}}
        return None


class Finance:
    def __init__(self):
        self.calls = []
        self.failure = None

    async def read_account_risk_snapshot(self, scope):
        self.calls.append(("snapshot", scope))
        if self.failure:
            raise self.failure
        return {"strategyAccountId": scope.strategy_account_id,
                "reconciliationState": "clean", "admissionState": "stopped",
                "accountRevision": "7"}

    async def read_withdrawable_balance(self, scope, asset_unit_id, location_id):
        self.calls.append(("withdrawable", scope, asset_unit_id, location_id))
        if self.failure:
            raise self.failure
        return {"status": "unknown", "units": None,
                "reason": "capacity_unavailable", "revision": "7"}


def client(monkeypatch):
    OwnerClient.calls = []
    monkeypatch.setattr(finance_routes, "ConvexWorkerClient", OwnerClient)
    monkeypatch.setattr(finance_routes, "get_settings", lambda:
        SimpleNamespace(worker_shared_secret=SimpleNamespace(
            get_secret_value=lambda: "local-secret")))
    app = FastAPI()
    app.include_router(finance_routes.router)
    finance = Finance()
    app.state.finance = finance
    return TestClient(app), finance


def headers(subject="alice", bearer="local-secret"):
    return {"Authorization": f"Bearer {bearer}", "X-Moeazi-Subject": subject}


def test_finance_reads_require_worker_bearer_and_subject(monkeypatch):
    http, finance = client(monkeypatch)
    assert http.get("/v1/finance/snapshot").status_code == 401
    assert http.get("/v1/finance/snapshot", headers=headers(bearer="wrong")).status_code == 401
    assert http.get("/v1/finance/snapshot",
        headers={"Authorization": "Bearer local-secret"}).status_code == 401
    assert finance.calls == [] and OwnerClient.calls == []


def test_owned_stopped_account_reads_and_caller_account_query_cannot_select_other(monkeypatch):
    http, finance = client(monkeypatch)
    response = http.get("/v1/finance/snapshot?strategyAccountId=acct-b", headers=headers())
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "clean" and body["snapshot"]["admissionState"] == "stopped"
    assert body["snapshot"]["strategyAccountId"] == "acct-a"
    assert body["authority"] == "financial_review_only"
    assert body["executionQualified"] is False
    assert finance.calls[-1][1].strategy_account_id == "acct-a"
    assert OwnerClient.calls[-1] == {"subject": "alice", "environment": "live"}


def test_foreign_or_unowned_experiment_cannot_read_financial_state(monkeypatch):
    http, finance = client(monkeypatch)
    assert http.get("/v1/finance/snapshot", headers=headers("bob")).status_code == 404
    assert http.get("/v1/finance/snapshot?environment=experiment&experimentSpecId=spec-b",
        headers=headers()).status_code == 404
    assert http.get("/v1/finance/snapshot?environment=experiment",
        headers=headers()).status_code == 422
    assert http.get("/v1/finance/snapshot?experimentSpecId=spec-a",
        headers=headers()).status_code == 422
    owned = http.get("/v1/finance/snapshot?environment=experiment&experimentSpecId=spec-a",
        headers=headers())
    assert owned.status_code == 200
    assert finance.calls[-1][1].scope_id == "spec-a"


def test_finance_outage_is_503_and_unknown_is_never_zero(monkeypatch):
    http, finance = client(monkeypatch)
    finance.failure = RuntimeError("database unavailable")
    assert http.get("/v1/finance/snapshot", headers=headers()).status_code == 503
    finance.failure = FinanceError("unreconciled")
    response = http.get("/v1/finance/snapshot", headers=headers())
    assert response.status_code == 200
    assert response.json()["snapshot"] is None and response.json()["status"] == "unknown"
    assert response.json()["executionQualified"] is False
    response = http.get("/v1/finance/withdrawable?assetUnitId=USDC:6&locationId=wallet",
        headers=headers())
    assert response.status_code == 200
    assert response.json()["units"] is None and response.json()["status"] == "unknown"


def test_finance_routes_have_no_write_surface(monkeypatch):
    http, finance = client(monkeypatch)
    assert http.post("/v1/finance/snapshot", headers=headers()).status_code == 405
    assert http.post("/v1/finance/reserve", headers=headers()).status_code == 404
    assert finance.calls == []
