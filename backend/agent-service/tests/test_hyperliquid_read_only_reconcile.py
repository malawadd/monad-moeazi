"""Mocked public reads for Hyperliquid's explicitly partial account snapshot."""
import httpx
import pytest

from moeazi_agent.venues import HyperliquidAdapter


ACCOUNT = "0x1234567890abcdef1234567890abcdef12345678"
SPOT = {"balances": [{"coin": "USDC", "token": 0, "hold": "1.0",
                       "total": "10.0", "entryNtl": "9.0"}]}
PERPS = {"assetPositions": [{"position": {"coin": "BTC", "szi": "0.1"}}],
    "marginSummary": {"accountValue": "50.0", "totalMarginUsed": "5.0",
        "totalNtlPos": "20.0", "totalRawUsd": "45.0"}, "time": 1_700_000_000_000}
ORDERS = [{"coin": "BTC", "limitPx": "100.0", "oid": 12, "side": "A",
           "sz": "0.1", "timestamp": 1_700_000_000_000}]


class Response:
    def __init__(self, payload=None, status=200):
        self.payload, self.status_code = payload, status
        self.request = httpx.Request("POST", "https://api.hyperliquid.xyz/info")
    def raise_for_status(self):
        if self.status_code >= 400:
            response = httpx.Response(self.status_code, request=self.request)
            raise httpx.HTTPStatusError("mock status", request=self.request, response=response)
    def json(self): return self.payload


class Client:
    def __init__(self, responses): self.responses, self.calls = list(responses), []
    async def post(self, path, *, json):
        self.calls.append((path, json))
        return self.responses.pop(0)


@pytest.mark.asyncio
async def test_reconcile_returns_exact_address_scoped_reads_with_partial_status():
    adapter = HyperliquidAdapter("https://api.hyperliquid.xyz", live_enabled=False)
    client = Client([Response(SPOT), Response(PERPS), Response(ORDERS)])
    adapter.client = client
    result = await adapter.reconcile(ACCOUNT)
    assert [body for _, body in client.calls] == [
        {"type": "spotClearinghouseState", "user": ACCOUNT},
        {"type": "clearinghouseState", "user": ACCOUNT},
        {"type": "openOrders", "user": ACCOUNT},
    ]
    assert result["account"] == ACCOUNT
    assert result["positions"] == PERPS["assetPositions"]
    assert result["spotBalances"] == SPOT["balances"]
    assert result["perpetualAccountState"] == PERPS
    assert result["openOrders"] == ORDERS
    status = result["snapshot"]
    assert status["status"] == "partial" and status["certified"] is False
    assert status["readConsistency"] == "non_atomic"
    assert status["coverage"] == "default_perp_dex_and_first_spot_dex"
    assert {key: value["payload"] for key, value in status["sourceReads"].items()} == {
        "spotClearinghouseState": SPOT, "clearinghouseState": PERPS, "openOrders": ORDERS}
    assert all(value["requestedAt"] <= value["receivedAt"]
               for value in status["sourceReads"].values())


@pytest.mark.asyncio
async def test_reconcile_rejects_invalid_address_before_network_io():
    adapter = HyperliquidAdapter("https://api.hyperliquid.xyz", live_enabled=False)
    client = Client([])
    adapter.client = client
    with pytest.raises(ValueError, match="exact 0x account address"):
        await adapter.reconcile("user-address-from-somewhere")
    assert client.calls == []


@pytest.mark.asyncio
async def test_reconcile_fails_closed_on_malformed_state_or_http_error():
    adapter = HyperliquidAdapter("https://api.hyperliquid.xyz", live_enabled=False)
    malformed = Client([Response({"balances": [{"coin": "USDC"}]})])
    adapter.client = malformed
    with pytest.raises(ValueError, match="Malformed Hyperliquid spot balance"):
        await adapter.reconcile(ACCOUNT)
    assert len(malformed.calls) == 1

    failed = Client([Response(SPOT), Response(status=503), Response(ORDERS)])
    adapter.client = failed
    with pytest.raises(httpx.HTTPStatusError):
        await adapter.reconcile(ACCOUNT)
    assert len(failed.calls) == 2
