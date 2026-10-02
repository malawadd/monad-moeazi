import asyncio
import json

import httpx
import pytest

from moeazi_agent.gateway_credentials import GatewayCredentialClient, HyperliquidCredentialScope


MASTER = "0x" + "1" * 40
AGENT = "0x" + "2" * 40
TARGET = "0x" + "3" * 40


def credential():
    return {
        "strategyAccountId": "strategy-a", "venueAccountId": "venue-a",
        "targetAddress": TARGET, "masterAddress": MASTER,
        "targetKind": "subaccount", "apiWalletAddress": AGENT,
        "encryptedEnvelope": "opaque", "kmsKeyRef": "test-kms", "keyVersion": 1,
        "credentialContext": f"venue-credential:v1:strategy-a:hyperliquid:{AGENT}",
        "permissionExpiresAt": 4_000_000_000_000, "limitsJson": '{"maxOrderUsd":5}',
    }


def test_scope_rejects_mismatched_target_and_encryption_context():
    valid = credential()
    assert HyperliquidCredentialScope.model_validate(valid).targetAddress == TARGET
    with pytest.raises(ValueError, match="target and master"):
        HyperliquidCredentialScope.model_validate({**valid, "targetKind": "master"})
    with pytest.raises(ValueError, match="encryption context"):
        HyperliquidCredentialScope.model_validate({**valid, "credentialContext": "other"})


def test_client_requires_separate_secret_and_exact_scope(monkeypatch):
    with pytest.raises(ValueError, match="secret"):
        GatewayCredentialClient("https://example.convex.site/execution-gateway/credential", "short")

    calls = []
    async def respond(request):
        calls.append(request)
        return httpx.Response(200, json=credential())

    class FakeClient(httpx.AsyncClient):
        def __init__(self, *args, **kwargs):
            super().__init__(transport=httpx.MockTransport(respond), *args, **kwargs)

    monkeypatch.setattr("moeazi_agent.gateway_credentials.httpx.AsyncClient", FakeClient)
    client = GatewayCredentialClient("https://example.convex.site/execution-gateway/credential", "s" * 32)
    result = asyncio.run(client.hyperliquid("strategy-a", "venue-a", TARGET))
    assert result.encryptedEnvelope == "opaque"
    assert calls[0].headers["authorization"] == f"Bearer {'s' * 32}"
    assert json.loads(calls[0].content)["targetAddress"] == TARGET
    with pytest.raises(ValueError, match="target address"):
        asyncio.run(client.hyperliquid("strategy-a", "venue-a", "wrong"))
