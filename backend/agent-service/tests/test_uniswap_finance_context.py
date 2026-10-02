from types import SimpleNamespace

import pytest

from moeazi_agent import uniswap_finance_context as subject


def marker():
    ref = {"schemaVersion": 1, "environment": "live", "strategyAccountId": "acct-a",
           "controllerKind": "managed_program", "controllerId": "assignment-a",
           "controllerVersionId": "version-a", "contentHash": "b" * 64}
    return {"strategyAccountId": "acct-a",
            "sourceAccountId": "arbitrum:42161:wallet:0x" + "1" * 40,
            "reservationControllerRef": ref, "authorityFingerprint": "c" * 64}


def context():
    return {"financialAuthority": "identity_only", "strategyAccountId": "acct-a",
            "assignmentId": "assignment-a", "programVersionId": "version-a",
            "contentHash": "b" * 64, "executionGrantId": "grant-0001",
            "sourceAccountId": "arbitrum:42161:wallet:0x" + "1" * 40,
            "venue": "uniswap", "policyHash": "d" * 64}


def test_controller_binding_requires_exact_frozen_version():
    row = marker()
    assert subject._controller_matches(row, context(), "assignment-a", "acct-a")
    row["reservationControllerRef"]["controllerVersionId"] = "version-b"
    assert not subject._controller_matches(row, context(), "assignment-a", "acct-a")


@pytest.mark.asyncio
async def test_current_marker_requires_live_financial_authority(monkeypatch):
    calls = []

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return context()

    class Http:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def post(self, url, *, headers, json):
            calls.append((url, headers, json))
            return Response()

    class Convex:
        def __init__(self, _settings):
            self.client = SimpleNamespace(aclose=self.close)

        async def close(self):
            pass

        async def command(self, command, **payload):
            assert command == "getFinanceAuthorityContext"
            assert payload["controllerRef"] == marker()["reservationControllerRef"]
            return {"allowed": True, "reason": "ready_for_financial_review",
                    "controllerMode": "autopilot", "authorityFingerprint": "c" * 64}

    monkeypatch.setattr(subject, "get_settings", lambda: SimpleNamespace(
        convex_worker_url="https://example.convex.site/worker",
        worker_shared_secret=SimpleNamespace(get_secret_value=lambda: "secret")))
    monkeypatch.setattr(subject.httpx, "AsyncClient", lambda **_: Http())
    monkeypatch.setattr(subject, "ConvexWorkerClient", Convex)
    result = await subject.verify_current_managed_uniswap_marker(marker(),
        strategy_account_id="acct-a", assignment_id="assignment-a", grant_id="grant-0001")
    assert result == {"grantId": "grant-0001", "assignmentId": "assignment-a",
                      "frozenProgramPolicyHash": "0x" + "d" * 64}
    assert calls[0][0] == "https://example.convex.site/native-finance-activation/context"
    assert calls[0][2] == {"assignmentId": "assignment-a", "executionGrantId": "grant-0001"}


@pytest.mark.asyncio
async def test_stale_or_foreign_marker_is_denied_before_finance_lookup(monkeypatch):
    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return context()

    class Http:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def post(self, *_args, **_kwargs):
            return Response()

    class Convex:
        def __init__(self, _settings):
            raise AssertionError("foreign marker must never reach authority lookup")

    monkeypatch.setattr(subject, "get_settings", lambda: SimpleNamespace(
        convex_worker_url="https://example.convex.site/worker",
        worker_shared_secret=SimpleNamespace(get_secret_value=lambda: "secret")))
    monkeypatch.setattr(subject.httpx, "AsyncClient", lambda **_: Http())
    monkeypatch.setattr(subject, "ConvexWorkerClient", Convex)
    row = marker()
    row["reservationControllerRef"]["contentHash"] = "e" * 64
    assert await subject.verify_current_managed_uniswap_marker(row,
        strategy_account_id="acct-a", assignment_id="assignment-a", grant_id="grant-0001") is None
