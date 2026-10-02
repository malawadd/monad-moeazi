import json
from datetime import timedelta

import pytest
import respx
import httpx
from httpx import Response

from moeazi_agent.config import Settings
from moeazi_agent.contracts import utc_now
from moeazi_agent.evidence_lifecycle_evaluator import _validate_shape
from moeazi_agent.openrouter_provider import OpenRouterProvider
from moeazi_agent.provider_catalog import _price, openrouter_model_details, probe_model
from moeazi_agent.providers import ProviderFailure
from moeazi_agent.roles import Assignment, ROLES


def assignment() -> Assignment:
    return Assignment(
        ROLES[0], "openrouter", model="anthropic/claude-sonnet",
        max_output_tokens=250,
        provider_preferences={
            "sort": "price", "allowFallbacks": True, "allowedProviders": ["Anthropic"],
            "ignoredProviders": [], "dataCollection": "deny", "zeroDataRetention": True,
            "maxInputPriceMicrousdPerMillion": 3_000_000,
            "maxOutputPriceMicrousdPerMillion": 15_000_000,
        },
    )


def signal() -> dict:
    return {
        "role": "technical_trend", "provider": "openrouter",
        "model": "anthropic/claude-sonnet", "horizon": "hours",
        "stance": "bullish", "score": 0.4, "confidence": 0.7,
        "evidence": [], "risks": ["Volatility"], "decision_summary": "Momentum is constructive.",
        "key_factors": ["Trend"], "uncertainties": ["Macro"],
        "expires_at": (utc_now() + timedelta(minutes=5)).isoformat(),
    }


@respx.mock
async def test_openrouter_returns_typed_output_cost_and_actual_route():
    route = respx.post("https://openrouter.test/api/v1/chat/completions").mock(return_value=Response(200, json={
        "id": "gen-1", "model": "anthropic/claude-sonnet",
        "choices": [{"message": {"content": json.dumps(signal())}}],
        "usage": {
            "prompt_tokens": 100, "completion_tokens": 40, "cost": 0.0012,
            "prompt_tokens_details": {"cached_tokens": 20}, "is_byok": False,
        },
        "openrouter_metadata": {
            "strategy": "direct", "attempt": 2,
            "endpoints": {"available": [
                {"provider": "Anthropic", "model": "anthropic/claude-sonnet", "selected": True},
            ]},
            "attempts": [
                {"provider": "Other", "model": "anthropic/claude-sonnet", "status": 503},
                {"provider": "Anthropic", "model": "anthropic/claude-sonnet", "status": 200},
            ],
        },
    }))
    provider = OpenRouterProvider(Settings(
        openrouter_base_url="https://openrouter.test/api/v1", provider_retries=0,
    ), "secret")
    try:
        response = await provider.analyze(assignment(), "BTC-USD", "evidence")
    finally:
        await provider.close()

    assert response.value.provider == "openrouter"
    assert response.usage.provider_cost_microusd == 1_200
    assert response.usage.routing_metadata["upstreamProvider"] == "Anthropic"
    assert response.usage.routing_metadata["modelFamily"] == "anthropic"
    assert response.usage.routing_metadata["fallbackAttempts"] == 1
    _validate_shape({"metadata": response.usage.routing_metadata})
    body = json.loads(route.calls[0].request.content)
    assert body["response_format"]["json_schema"]["strict"] is True
    assert body["provider"]["require_parameters"] is True
    assert body["provider"]["zdr"] is True
    assert body["provider"]["max_price"] == {"prompt": 3, "completion": 15}
    assert "tools" not in body and "plugins" not in body and "models" not in body


@respx.mock
async def test_openrouter_rejects_invalid_structured_output_without_retry():
    route = respx.post("https://openrouter.test/api/v1/chat/completions").mock(
        return_value=Response(200, json={
            "id": "gen-bad", "model": "anthropic/claude-sonnet",
            "choices": [{"message": {"content": "{}"}}], "usage": {},
        }),
    )
    provider = OpenRouterProvider(Settings(
        openrouter_base_url="https://openrouter.test/api/v1", provider_retries=0,
    ), "secret")
    try:
        with pytest.raises(ProviderFailure, match="invalid structured output"):
            await provider.analyze(assignment(), "BTC-USD", "evidence")
    finally:
        await provider.close()
    assert route.call_count == 1


@pytest.mark.parametrize("status, message", [
    (401, "key is invalid"),
    (402, "balance is exhausted"),
    (429, "HTTP 429"),
    (503, "HTTP 503"),
])
@respx.mock
async def test_openrouter_maps_provider_failures(status: int, message: str):
    route = respx.post("https://openrouter.test/api/v1/chat/completions").mock(
        return_value=Response(status, json={"error": {"message": "upstream detail"}}),
    )
    provider = OpenRouterProvider(Settings(
        openrouter_base_url="https://openrouter.test/api/v1", provider_retries=0,
    ), "secret")
    try:
        with pytest.raises(ProviderFailure, match=message):
            await provider.analyze(assignment(), "BTC-USD", "evidence")
    finally:
        await provider.close()
    assert route.call_count == 1


@respx.mock
async def test_openrouter_maps_timeout():
    timeout_route = respx.post("https://openrouter.test/api/v1/chat/completions").mock(
        side_effect=httpx.ReadTimeout("slow"),
    )
    provider = OpenRouterProvider(Settings(
        openrouter_base_url="https://openrouter.test/api/v1", provider_retries=0,
    ), "secret")
    try:
        with pytest.raises(ProviderFailure, match="slow"):
            await provider.analyze(assignment(), "BTC-USD", "evidence")
    finally:
        await provider.close()
    assert timeout_route.call_count == 1



@respx.mock
async def test_openrouter_rejects_empty_output():
    empty_route = respx.post("https://openrouter.test/api/v1/chat/completions").mock(
        return_value=Response(200, json={
            "id": "gen-empty", "model": "anthropic/claude-sonnet",
            "choices": [{"message": {"content": ""}}], "usage": {},
        }),
    )
    provider = OpenRouterProvider(Settings(
        openrouter_base_url="https://openrouter.test/api/v1", provider_retries=0,
    ), "secret")
    try:
        with pytest.raises(ProviderFailure, match="empty content"):
            await provider.analyze(assignment(), "BTC-USD", "evidence")
    finally:
        await provider.close()
    assert empty_route.call_count == 1


@respx.mock
async def test_openrouter_generation_cost_is_used_when_inline_cost_is_missing():
    respx.post("https://openrouter.test/api/v1/chat/completions").mock(return_value=Response(200, json={
        "id": "gen-2", "model": "anthropic/claude-sonnet",
        "choices": [{"message": {"content": json.dumps(signal())}}],
        "usage": {"prompt_tokens": 20, "completion_tokens": 10},
    }))
    respx.get("https://openrouter.test/api/v1/generation?id=gen-2").mock(
        return_value=Response(200, json={"data": {"total_cost": 0.0004}}),
    )
    provider = OpenRouterProvider(Settings(
        openrouter_base_url="https://openrouter.test/api/v1", provider_retries=0,
    ), "secret")
    try:
        response = await provider.analyze(assignment(), "BTC-USD", "evidence")
    finally:
        await provider.close()
    assert response.usage.provider_cost_microusd == 400
    assert response.usage.cost_source == "provider_reported"
    assert response.usage.routing_metadata["modelFamily"] == "unknown"


@respx.mock
async def test_openrouter_endpoint_prices_are_converted_and_bounded():
    respx.get("https://openrouter.test/api/v1/models/anthropic/claude/endpoints").mock(
        return_value=Response(200, json={"data": {
            "name": "Claude", "context_length": 100_000, "endpoints": [
                {"provider_name": "A", "supported_parameters": ["structured_outputs"],
                 "pricing": {"prompt": "0.000001", "completion": "0.000005"}},
                {"provider_name": "B", "supported_parameters": ["structured_outputs"],
                 "pricing": {"prompt": "0.000002", "completion": "0.000006"}},
            ],
        }}),
    )
    detail = await openrouter_model_details(
        "anthropic/claude", "secret",
        Settings(openrouter_base_url="https://openrouter.test/api/v1"),
    )
    assert _price("0.000001") == 1_000_000
    assert detail["inputPriceMicrousdPerMillion"] == 1_000_000
    assert detail["maximumInputPriceMicrousdPerMillion"] == 2_000_000
    assert detail["maximumOutputPriceMicrousdPerMillion"] == 6_000_000
    assert detail["upstreamProviders"] == ["A", "B"]


@respx.mock
async def test_openrouter_compatibility_probe_uses_per_million_token_price_cap():
    respx.get("https://openrouter.test/api/v1/models/anthropic/claude/endpoints").mock(
        return_value=Response(200, json={"data": {"name": "Claude", "endpoints": [
            {"provider_name": "A", "supported_parameters": ["structured_outputs"],
             "pricing": {"prompt": "0.000002", "completion": "0.000006"}},
        ]}}),
    )
    route = respx.post("https://openrouter.test/api/v1/chat/completions").mock(
        return_value=Response(200, json={"choices": [{"message": {"content": json.dumps({
            "decision_summary": "Compatible typed response",
            "key_factors": ["Test fixture"], "confidence": 0.7,
        })}}], "usage": {"prompt_tokens": 10, "completion_tokens": 10, "cost": 0.0001}}),
    )
    result = await probe_model("openrouter", "anthropic/claude", "secret",
        Settings(openrouter_base_url="https://openrouter.test/api/v1"))
    body = json.loads(route.calls[0].request.content)
    assert body["provider"]["max_price"] == {"prompt": 2, "completion": 6}
    assert result["usage"]["costMicrousd"] == 100
