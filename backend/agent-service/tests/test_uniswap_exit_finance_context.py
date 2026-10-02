from types import SimpleNamespace

import pytest

from moeazi_agent import uniswap_exit_finance_context as subject


OWNER = "0x" + "1" * 40
REF = {"schemaVersion": 1, "environment": "live", "strategyAccountId": "acct-a",
       "controllerKind": "managed_program", "controllerId": "assignment-a",
       "controllerVersionId": "version-a", "contentHash": "b" * 64}


def marker():
    return {"customerSubject": "customer-a", "strategyAccountId": "acct-a",
        "sourceAccountId": "arbitrum:42161:wallet:" + OWNER,
        "reservationControllerRef": REF,
        "frozenProgramPolicyHash": "0x" + "c" * 64}


def context():
    return {"authority": "reduce_only_close", "customerSubject": "customer-a",
        "strategyAccountId": "acct-a", "assignmentId": "assignment-a",
        "programVersionId": "version-a", "ownerAddress": OWNER,
        "sourceAccountId": "arbitrum:42161:wallet:" + OWNER,
        "executionGrantId": "grant-a", "controllerRef": REF,
        "frozenProgramPolicyHash": "c" * 64}


@pytest.mark.asyncio
async def test_stopped_exit_marker_requires_exact_owner_and_grant_context(monkeypatch):
    response_data = context()
    calls = []

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return response_data

    class Http:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def post(self, url, *, headers, json):
            calls.append((url, headers, json))
            return Response()

    monkeypatch.setattr(subject, "get_settings", lambda: SimpleNamespace(
        convex_worker_url="https://example.convex.site/worker",
        worker_shared_secret=SimpleNamespace(get_secret_value=lambda: "secret")))
    monkeypatch.setattr(subject.httpx, "AsyncClient", lambda **_: Http())
    assert await subject.verify_stopped_managed_uniswap_exit(marker(),
        strategy_account_id="acct-a", assignment_id="assignment-a", grant_id="grant-a") == {
            "grantId": "grant-a", "assignmentId": "assignment-a",
            "frozenProgramPolicyHash": "0x" + "c" * 64}
    assert calls[0][0] == "https://example.convex.site/native-finance-trade/close-context"
    assert calls[0][2] == {"assignmentId": "assignment-a", "subject": "customer-a"}
    response_data["ownerAddress"] = "0x" + "2" * 40
    assert await subject.verify_stopped_managed_uniswap_exit(marker(),
        strategy_account_id="acct-a", assignment_id="assignment-a", grant_id="grant-a") is None
