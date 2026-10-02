from types import SimpleNamespace

import pytest

from moeazi_agent import finance_native_stop_api as target
from moeazi_agent.finance_contracts import FinanceScope


class Connection:
    def __init__(self, row):
        self.row = row

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        pass

    async def execute(self, _query, _params):
        return SimpleNamespace(mappings=lambda: SimpleNamespace(first=lambda: self.row))


class Finance:
    def __init__(self, row):
        self.engine = SimpleNamespace(connect=lambda: Connection(row))
        self.stops = []

    async def acquire_writer_epoch(self, scope, writer_id):
        assert scope.strategy_account_id == "account-a"
        assert writer_id == "native-uniswap-activation-v1"
        return 3

    async def set_account_stop(self, scope, epoch, revision, *, stopped,
                               idempotency_key, request_hash):
        self.stops.append((epoch, revision, stopped, idempotency_key, request_hash))
        return {"state": "stopped", "revision": revision + 1, "authorityEpoch": 2}


@pytest.mark.asyncio
async def test_stop_revokes_native_admission_for_the_viewer_scope(monkeypatch):
    async def scope(_subject, _environment, _experiment):
        return FinanceScope(environment="live", scope_id="live", strategy_account_id="account-a")

    monkeypatch.setattr(target, "_subject", lambda *_: "customer-subject")
    monkeypatch.setattr(target, "_viewer_scope", scope)
    finance = Finance({"revision": 4, "admission_state": "open"})
    response = await target.stop_managed_program_admission(
        SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(finance=finance))),
        "Bearer secret", "customer-subject")
    assert response["nativeFinanceAdmissionStopped"] is True
    assert response["positionClosure"] == "unconfirmed"
    assert finance.stops[0][:4] == (3, 4, True, "mobile-native-stop:account-a:4")


@pytest.mark.asyncio
async def test_stop_does_not_register_an_absent_financial_account(monkeypatch):
    async def scope(*_):
        return FinanceScope(environment="live", scope_id="live", strategy_account_id="account-a")

    monkeypatch.setattr(target, "_subject", lambda *_: "customer-subject")
    monkeypatch.setattr(target, "_viewer_scope", scope)
    finance = Finance(None)
    response = await target.stop_managed_program_admission(
        SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(finance=finance))),
        "Bearer secret", "customer-subject")
    assert response["status"] == "not_registered"
    assert response["nativeFinanceAdmissionStopped"] is True
    assert finance.stops == []
