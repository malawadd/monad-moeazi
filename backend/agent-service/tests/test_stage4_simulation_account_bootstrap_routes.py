"""Authenticated experiment account bootstrap contract, retry, and isolation."""
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from moeazi_agent import finance_routes, simulation_bootstrap_routes
from moeazi_agent.account_observation_storage import account_snapshot_hash
from moeazi_agent.finance_contracts import FinanceScope
from moeazi_agent.finance_repository import FinanceRepository
from moeazi_agent.finance_observation_contracts import (
    AccountObservationSnapshotRef, ObservedBalance,
)
from moeazi_agent.finance_policy import SizingPolicy
from moeazi_agent.simulation_routes import router


NOW = datetime.now(timezone.utc)
HASH = "a" * 64
HEADERS = {"Authorization": "Bearer route-test", "X-Moeazi-Subject": "alice"}


def policy(version="fixture-policy-v1", *, approved_live=False):
    body = dict(policy_version=version, instrument_version_id="BTC/USDC:v1",
        max_quantity_units="100", min_quantity_units="1", quantity_step_units="1",
        max_gross_notional_units="1000000", max_directional_notional_units="1000000",
        initial_margin_bps=1000, fee_ceiling_units="0", exit_buffer_units="0",
        max_observation_age_seconds=3600, max_reservation_seconds=60,
        approved_live=approved_live)
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"),
        ensure_ascii=False).encode()
    digest = hashlib.sha256(b"moeazi-finance-policy-v1\n" + canonical).hexdigest()
    return SizingPolicy(**body, policy_hash=digest)


def snapshot(scope, identity="a", *, version="fixture-policy-v1", rights="internal_qualification_only"):
    seen = NOW - timedelta(seconds=20)
    provisional = AccountObservationSnapshotRef(
        scope=scope, snapshot_hash="0" * 64, source_account_id=f"fixture:{identity}",
        origin="recorded_fixture", status="accepted", event_at=seen,
        available_at=seen, received_at=seen, cutoff_at=NOW - timedelta(seconds=10),
        finality="admitted_final", finality_at=seen, has_gap=False, has_reorg=False,
        balances_complete=True, positions_complete=True, rights_ref=rights,
        source_event_hash=HASH, source_payload_hash="b" * 64, registry_hash="c" * 64,
        policy_version=version, observed_balances=(ObservedBalance(
            asset_unit_id="USDC:6", location_id="fixture-wallet", book="wallet",
            units="1000000", registry_hash="c" * 64),), observed_positions=())
    return AccountObservationSnapshotRef.model_validate(provisional.model_dump() | {
        "snapshot_hash": account_snapshot_hash(provisional)})


class FakeFinance:
    def __init__(self):
        self.engine = object()
        self.accounts = {}
        self.reconcile_claims = {}
        self.stop_claims = {}
        self.openings = 0
        self.calls = []

    @staticmethod
    def key(scope):
        return scope.scope_id, scope.strategy_account_id

    async def acquire_writer_epoch(self, scope, writer_id):
        self.calls.append(("epoch", self.key(scope), writer_id))
        return 7

    async def read_account_risk_snapshot(self, scope):
        state = self.accounts.setdefault(self.key(scope), {
            "revision": 0, "snapshot": None, "policy": None})
        return {"accountRevision": str(state["revision"]),
                "observationSnapshotHash": state["snapshot"]}

    async def register_policy(self, scope, epoch, policy_value):
        self.calls.append(("policy", self.key(scope), epoch, policy_value.policy_hash))

    async def reconcile_account(self, command, *, bootstrap):
        assert bootstrap is True and command.writer_epoch == 7
        key = (*self.key(command.scope), command.idempotency_key)
        if key in self.reconcile_claims:
            return self.reconcile_claims[key]
        state = self.accounts[self.key(command.scope)]
        assert command.expected_revision == state["revision"]
        state["revision"] += 1
        state["snapshot"] = command.snapshot_hash
        self.openings += 1
        result = {"revision": state["revision"], "status": "clean"}
        self.reconcile_claims[key] = result
        self.calls.append(("reconcile", self.key(command.scope), command.request_hash))
        return result

    async def set_account_stop(self, scope, epoch, revision, *, stopped,
                               idempotency_key, request_hash):
        assert stopped is False and epoch == 7
        key = (*self.key(scope), idempotency_key)
        if key in self.stop_claims:
            return self.stop_claims[key]
        state = self.accounts[self.key(scope)]
        assert revision == state["revision"]
        state["revision"] += 1
        result = {"revision": state["revision"], "state": "open"}
        self.stop_claims[key] = result
        self.calls.append(("open", self.key(scope), request_hash))
        return result


def setup(monkeypatch):
    finance = FakeFinance()
    identities = {"spec-a": FinanceScope(environment="experiment", scope_id="spec-a",
        strategy_account_id="acct-a"), "spec-b": FinanceScope(environment="experiment",
        scope_id="spec-b", strategy_account_id="acct-b")}
    monkeypatch.setattr(finance_routes, "get_settings", lambda: SimpleNamespace(
        worker_shared_secret=SimpleNamespace(get_secret_value=lambda: "route-test")))

    async def identity(subject, experiment_spec_id):
        assert subject == "alice"
        return SimpleNamespace(scope=identities[experiment_spec_id],
            experiment_request_hash="d" * 64, authority_fingerprint="e" * 64)

    monkeypatch.setattr(simulation_bootstrap_routes, "_identity", identity)

    class ObservationStore:
        def __init__(self, engine):
            assert engine is finance.engine

        async def store_experiment_fixture(self, value):
            finance.calls.append(("observation", value.scope.scope_id, value.snapshot_hash))
            return value.snapshot_hash

    monkeypatch.setattr(simulation_bootstrap_routes, "AccountObservationRepository", ObservationStore)
    app = FastAPI()
    app.include_router(router)
    app.state.finance = finance
    return TestClient(app), finance, identities


def request_body(scope, *, key="bootstrap-key-0001", snapshot_value=None, policy_value=None):
    return {"experiment_spec_id": scope.scope_id,
        "snapshot": (snapshot_value or snapshot(scope)).model_dump(mode="json"),
        "policy": (policy_value or policy()).model_dump(mode="json"),
        "idempotency_key": key}


def test_bootstrap_is_clean_idempotent_and_does_not_duplicate_opening_funds(monkeypatch):
    http, finance, identities = setup(monkeypatch)
    body = request_body(identities["spec-a"])
    first = http.post("/v1/simulation/accounts/bootstrap", headers=HEADERS, json=body)
    retry = http.post("/v1/simulation/accounts/bootstrap", headers=HEADERS, json=body)
    assert first.status_code == retry.status_code == 200
    assert first.json()["status"] == "clean" and first.json()["duplicate"] is False
    assert retry.json()["duplicate"] is True
    assert first.json()["revision"] == retry.json()["revision"] == 2
    assert first.json()["experimentSpecId"] == "spec-a"
    assert first.json()["accountSnapshotHash"] == body["snapshot"]["snapshot_hash"]
    assert first.json()["policyHash"] == body["policy"]["policy_hash"]
    assert first.json()["lineage"]["strategyAccountId"] == "acct-a"
    assert first.json()["lineage"]["sourceEventHash"] == HASH
    assert finance.openings == 1
    epochs = [call for call in finance.calls if call[0] == "epoch"]
    assert len(epochs) == 2 and epochs[0][2] == epochs[1][2]


def test_bootstrap_rejects_untrusted_or_mismatched_financial_inputs(monkeypatch):
    http, finance, identities = setup(monkeypatch)
    scope = identities["spec-a"]
    assert http.post("/v1/simulation/accounts/bootstrap", json=request_body(scope)).status_code == 401
    extra = request_body(scope) | {"writer_epoch": 7}
    assert http.post("/v1/simulation/accounts/bootstrap", headers=HEADERS, json=extra).status_code == 422
    extra_subject = request_body(scope) | {"subject": "alice"}
    assert http.post("/v1/simulation/accounts/bootstrap", headers=HEADERS,
        json=extra_subject).status_code == 422
    assert http.post("/v1/simulation/accounts/bootstrap", headers=HEADERS,
        json=request_body(scope, policy_value=policy(approved_live=True))).status_code == 422
    assert http.post("/v1/simulation/accounts/bootstrap", headers=HEADERS,
        json=request_body(scope, policy_value=policy("different-version"))).status_code == 422
    foreign = snapshot(FinanceScope(environment="experiment", scope_id="spec-a",
        strategy_account_id="acct-foreign"))
    assert http.post("/v1/simulation/accounts/bootstrap", headers=HEADERS,
        json=request_body(scope, snapshot_value=foreign)).status_code == 403
    unqualified = snapshot(scope, rights="public_market_data")
    assert http.post("/v1/simulation/accounts/bootstrap", headers=HEADERS,
        json=request_body(scope, snapshot_value=unqualified)).status_code == 422
    assert finance.calls == []


def test_experiment_spec_identity_keeps_financial_accounts_isolated(monkeypatch):
    http, finance, identities = setup(monkeypatch)
    for spec_id in ("spec-a", "spec-b"):
        response = http.post("/v1/simulation/accounts/bootstrap", headers=HEADERS,
            json=request_body(identities[spec_id], key=f"bootstrap-{spec_id}-key"))
        assert response.status_code == 200, response.text
    scopes = {call[1] for call in finance.calls if call[0] == "reconcile"}
    assert scopes == {("spec-a", "acct-a"), ("spec-b", "acct-b")}
    assert len(finance.accounts) == 2


@pytest.mark.asyncio
async def test_bootstrap_real_sql_opens_once_and_returns_registration_revision(monkeypatch):
    raw = os.getenv("MOEAZI_Q4_POSTGRES_DSN")
    if not raw:
        pytest.skip("explicit disposable Q4 database opt-in required")
    url = make_url(raw)
    if (url.drivername, url.host, url.port, url.database) != (
            "postgresql+asyncpg", "127.0.0.1", 15432, "moeazi_q4_20260930"):
        raise RuntimeError("Only root's disposable loopback Q4 database is permitted")
    unique = uuid4().hex
    scope = FinanceScope(environment="experiment", scope_id=f"stage4-{unique}",
                         strategy_account_id=f"acct-{unique}")
    engine = create_async_engine(raw)
    finance = FinanceRepository(engine)
    app = FastAPI()
    app.state.finance = finance

    async def identity(subject, experiment_spec_id):
        assert subject == "alice" and experiment_spec_id == scope.scope_id
        return SimpleNamespace(scope=scope, experiment_request_hash="d" * 64,
                               authority_fingerprint="e" * 64)

    monkeypatch.setattr(simulation_bootstrap_routes, "_identity", identity)
    monkeypatch.setattr(finance_routes, "get_settings", lambda: SimpleNamespace(
        worker_shared_secret=SimpleNamespace(get_secret_value=lambda: "route-test")))
    body = request_body(scope, key=f"bootstrap-{unique}")
    request = SimpleNamespace(app=app)
    try:
        first = await simulation_bootstrap_routes.bootstrap_experiment_account(
            body, request, "Bearer route-test", "alice")
        retry = await simulation_bootstrap_routes.bootstrap_experiment_account(
            body, request, "Bearer route-test", "alice")
        assert first["status"] == retry["status"] == "clean"
        assert first["revision"] == retry["revision"] == 2
        assert first["duplicate"] is False and retry["duplicate"] is True
        state = await finance.read_account_risk_snapshot(scope)
        assert state["accountRevision"] == "2"
        assert state["observationSnapshotHash"] == body["snapshot"]["snapshot_hash"]
        async with engine.connect() as conn:
            count = (await conn.execute(text("""
                SELECT count(*) FROM finance_journal_transactions
                WHERE environment=:environment AND scope_id=:scope_id
                  AND strategy_account_id=:strategy_account_id
            """), scope.model_dump())).scalar_one()
        assert count == 1
    finally:
        await engine.dispose()
