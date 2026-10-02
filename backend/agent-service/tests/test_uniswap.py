import pytest

from moeazi_agent import swap_api
from moeazi_agent.routing_contracts import SwapQuoteRequest
from moeazi_agent.venues import UniswapTradingApiAdapter


def test_swap_body_spreads_quote_and_strips_null_permit():
    quote = {"quote": {"routing": "CLASSIC"}, "permitData": None, "requestId": "q1"}
    body = UniswapTradingApiAdapter.swap_body(quote)
    assert body["quote"] == quote["quote"]
    assert "permitData" not in body


def test_swap_body_adds_signature_for_permit():
    body = UniswapTradingApiAdapter.swap_body({"permitData": {"domain": {}}}, "0xsigned")
    assert body["signature"] == "0xsigned"
    assert body["permitData"] == {"domain": {}}


def test_uniswap_x_swap_body_omits_permit_data():
    quote = {"routing": "DUTCH_V2", "permitData": {"domain": {}}, "quote": {}}
    body = UniswapTradingApiAdapter.swap_body(quote, "0xsigned")
    assert body["signature"] == "0xsigned"
    assert "permitData" not in body


def test_classic_without_signature_omits_permit_data():
    body = UniswapTradingApiAdapter.swap_body({"routing": "CLASSIC", "permitData": {"domain": {}}})
    assert "permitData" not in body


def test_prebroadcast_validation_rejects_empty_calldata():
    with pytest.raises(ValueError, match="data"):
        UniswapTradingApiAdapter.validate_transaction({"to": "0x" + "1" * 40, "data": "0x", "value": "0"})


def test_prebroadcast_validation_rejects_wrong_chain():
    with pytest.raises(ValueError, match="Arbitrum"):
        UniswapTradingApiAdapter.validate_transaction({
            "to": "0x" + "1" * 40, "from": "0x" + "2" * 40,
            "data": "0x12", "value": "0", "chainId": 1,
        })


@pytest.mark.asyncio
async def test_hook_quote_uses_separate_quote_only_sidecar_lane(monkeypatch):
    captured = {}

    async def fake_sidecar(path, payload):
        captured.update(path=path, payload=payload)
        return {"enabled": False, "reason": "Hook experiment is disabled"}

    monkeypatch.setattr(swap_api, "sidecar", fake_sidecar)
    request = SwapQuoteRequest(
        token_in="0x" + "1" * 40,
        token_out="0x" + "2" * 40,
        amount="1000000",
        token_in_chain_id="42161",
        token_out_chain_id="42161",
        swapper="0x" + "3" * 40,
        slippage_tolerance=0.5,
    )
    authorization = (
        f"Bearer {swap_api.settings.worker_shared_secret.get_secret_value()}"
    )
    result = await swap_api.hook_quote(request, authorization)
    assert captured["path"] == "hook-quote"
    assert captured["payload"]["amount"] == "1000000"
    assert captured["payload"]["slippageTolerance"] == 0.5
    assert result["enabled"] is False
