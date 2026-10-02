"""A Temporal cadence must renew the exact funded vault authority before research."""
from types import SimpleNamespace

import httpx
import pytest

from moeazi_agent import managed_vault_schedule_refresh as refresh_module


OWNER = "0x" + "a" * 40
BINDING = {"mandateId": "mandate-a", "customerSubject": "magic:owner-a",
           "ownerAddress": OWNER}
SETTINGS = SimpleNamespace(agent_api_url="http://api:8100",
    worker_shared_secret=SimpleNamespace(get_secret_value=lambda: "worker-secret"))


@pytest.mark.asyncio
async def test_cadence_refresh_uses_owned_mandate_and_exact_receipt(monkeypatch):
    seen = []

    def respond(request):
        seen.append(request)
        return httpx.Response(200, json={"status": "ready", "mandateId": "mandate-a",
            "ownerAddress": OWNER, "strategyAccountId": "account-a",
            "programVersionId": "version-a", "activationReceiptHash": "b" * 64})

    original = httpx.AsyncClient
    monkeypatch.setattr(refresh_module.httpx, "AsyncClient", lambda **kwargs:
        original(**kwargs, transport=httpx.MockTransport(respond)))
    assert await refresh_module.refresh_managed_vault_authority(SETTINGS, BINDING,
        strategy_account_id="account-a", program_version_id="version-a")
    assert len(seen) == 1
    assert seen[0].url.path.endswith("/vault-activation-authority")
    assert seen[0].headers["x-moeazi-subject"] == "magic:owner-a"
    assert seen[0].headers["authorization"] == "Bearer worker-secret"
    assert seen[0].read() == b'{"mandateId":"mandate-a"}'
    assert not await refresh_module.refresh_managed_vault_authority(SETTINGS,
        {**BINDING, "ownerAddress": "0xbroken"},
        strategy_account_id="account-a", program_version_id="version-a")
    assert len(seen) == 1


@pytest.mark.asyncio
async def test_cadence_refresh_rejects_mismatched_finance_receipt(monkeypatch):
    original = httpx.AsyncClient
    monkeypatch.setattr(refresh_module.httpx, "AsyncClient", lambda **kwargs:
        original(**kwargs, transport=httpx.MockTransport(lambda _request:
            httpx.Response(200, json={"status": "ready", "mandateId": "mandate-a",
                "ownerAddress": "0x" + "c" * 40,
                "strategyAccountId": "account-a", "programVersionId": "version-a",
                "activationReceiptHash": "b" * 64}))))
    assert not await refresh_module.refresh_managed_vault_authority(SETTINGS, BINDING,
        strategy_account_id="account-a", program_version_id="version-a")
