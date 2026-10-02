"""Unfunded HTTP contract for Start, abstain, Stop, then close as already flat."""
from types import SimpleNamespace
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr
import respx
from httpx import Response

from moeazi_agent.finance_contracts import FinanceScope
from moeazi_agent.finance_observation_contracts import ARBITRUM_WETH_UNIT_ID
from moeazi_agent.managed_uniswap_close_api import router
import moeazi_agent.managed_uniswap_close_api as close_api
import moeazi_agent.finance_routes as finance_routes


def test_already_flat_posts_exact_convex_proof_without_exit_grant(monkeypatch):
    scope = FinanceScope(environment="live", scope_id="live",
                         strategy_account_id="account-a")
    owner = "0x" + "a" * 40
    location = "arbitrum:42161:wallet:" + owner
    snapshot = SimpleNamespace(source_account_id=location,
        observed_balances=(SimpleNamespace(
        asset_unit_id=ARBITRUM_WETH_UNIT_ID, location_id=location,
        book="wallet", units="0"),))
    settings = SimpleNamespace(convex_worker_url="https://convex.test/worker",
        worker_shared_secret=SecretStr("secret"))
    context = {"authority": "reduce_only_close", "assignmentId": "assignment-a",
        "strategyAccountId": "account-a", "customerSubject": "subject-a",
        "programVersionId": "version-a", "ownerAddress": owner}
    proof = {"financeSnapshotHash": "a" * 64, "financeRevision": "9",
        "finalizedBlockNumber": "123", "finalizedBlockHash": "0x" + "b" * 64,
        "wethUnits": "0", "pendingAttemptCount": 0}

    async def viewer(*_):
        return scope

    async def no_binding(*_):
        return None

    async def observed(*_, **__):
        return snapshot

    async def verified(*_):
        return proof

    async def forbidden(*_, **__):
        raise AssertionError("already-flat branch must not read grant, quote or broadcast")

    monkeypatch.setattr(close_api, "get_settings", lambda: settings)
    monkeypatch.setattr(finance_routes, "get_settings", lambda: settings)
    monkeypatch.setattr(close_api, "_viewer_scope", viewer)
    monkeypatch.setattr(close_api, "load_exit_binding", no_binding)
    monkeypatch.setattr(close_api, "observe_stopped_pair", observed)
    monkeypatch.setattr(close_api, "verify_observed_flat", verified)
    monkeypatch.setattr(close_api, "active_exit_grant", forbidden)
    monkeypatch.setattr(close_api, "_readiness", forbidden)
    monkeypatch.setattr(close_api, "_sidecar", forbidden)
    app = FastAPI()
    app.state.finance = object()
    app.include_router(router)
    with respx.mock(assert_all_called=True) as network:
        close = network.post("https://convex.test/native-finance-trade/close-context")
        close.mock(return_value=Response(200, json=context))
        flat = network.post("https://convex.test/native-finance-trade/observed-flat")
        flat.mock(return_value=Response(200, json={"receiptId": "receipt-a",
            "closureConfirmed": True, "duplicate": False}))
        response = TestClient(app).post(
            "/v1/finance/managed-program/close-position",
            json={"assignmentId": "assignment-a", "idempotencyKey": "command-a"},
            headers={"Authorization": "Bearer secret",
                     "X-Moeazi-Subject": "subject-a"})
    assert response.status_code == 200, response.text
    assert response.json()["positionClosure"] == "confirmed_flat"
    assert response.json()["operationId"] is None
    assert json.loads(close.calls[0].request.content) == {
        "assignmentId": "assignment-a", "subject": "subject-a"}
    assert flat.calls[0].request.headers["authorization"] == "Bearer secret"
    assert json.loads(flat.calls[0].request.content) == {
        "strategyAccountId": "account-a", "assignmentId": "assignment-a",
        "programVersionId": "version-a", "ownerAddress": owner, **proof}


def test_close_route_rejects_unauthenticated_request_before_finance():
    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).post(
        "/v1/finance/managed-program/close-position",
        json={"assignmentId": "assignment-a", "idempotencyKey": "command-a"})
    assert response.status_code == 401
