import httpx
import pytest
from fastapi import HTTPException

from moeazi_agent import provider_api
from moeazi_agent.convex import _response_error
from moeazi_agent.provider_catalog import search_models
from moeazi_agent.provider_api import require_provider_owner


class FakeConvex:
    def __init__(self, result):
        self.result = result
        self.calls = []

    async def command(self, command, **payload):
        self.calls.append((command, payload))
        return self.result


def test_convex_error_keeps_useful_message_without_stack():
    response = httpx.Response(
        500,
        json={
            "error": (
                "Uncaught Error: Strategy account not found.\n"
                "    at handler (../convex/agentModels.ts:206:21)"
            )
        },
    )

    assert _response_error(response) == "Strategy account not found."


@pytest.mark.asyncio
async def test_provider_connection_requires_strategy_before_provider_call():
    convex = FakeConvex(None)

    with pytest.raises(HTTPException) as raised:
        await require_provider_owner(convex, "particle:user")

    assert raised.value.status_code == 409
    assert raised.value.detail == "Create a strategy account before connecting a model provider."
    assert convex.calls == [
        ("getProviderOwnerContext", {"subject": "particle:user"}),
    ]


@pytest.mark.asyncio
async def test_provider_connection_accepts_existing_strategy():
    owner = {"userId": "user-1", "strategyAccountId": "strategy-1"}
    convex = FakeConvex(owner)

    assert await require_provider_owner(convex, "particle:user") == owner


def test_catalog_search_returns_only_ranked_matches():
    models = [
        {"id": "ai21/jamba", "name": "AI21: Jamba", "author": "ai21"},
        {"id": "nvidia/nemotron-mini", "name": "NVIDIA: Nemotron Mini", "author": "nvidia"},
        {"id": "nvidia/llama-nemotron", "name": "NVIDIA: Llama Nemotron", "author": "nvidia"},
    ]

    results = search_models(models, "nvidia")

    assert [item["id"] for item in results] == [
        "nvidia/llama-nemotron",
        "nvidia/nemotron-mini",
    ]


def test_catalog_search_prioritizes_an_exact_model_id():
    exact = {"id": "poolside/laguna-s-2.1:free", "name": "Laguna", "author": "poolside"}
    models = [
        {"id": "poolside/laguna-s-2.1", "name": "Laguna", "author": "poolside"},
        exact,
    ]

    assert search_models(models, exact["id"]) == [exact]


@pytest.mark.asyncio
async def test_probe_resolves_connection_before_saving_model_details(monkeypatch):
    updates = []
    model = {
        "id": "nvidia/nemotron",
        "name": "Nemotron",
        "pricingKnown": True,
        "inputPriceMicrousdPerMillion": 1,
        "cachedInputPriceMicrousdPerMillion": 1,
        "outputPriceMicrousdPerMillion": 1,
    }

    async def fake_details(subject, connection_id):
        assert (subject, connection_id) == ("magic:user", "connection-1")
        return {
            "provider": "openrouter",
            "secretRef": "secret-1",
            "modelsJson": "[]",
            "capabilitiesJson": '{"compatibleModels":[],"modelDetails":{}}',
        }

    async def fake_with_secret(row, operation):
        return {"model": model, "usage": {"inputTokens": 1, "outputTokens": 1}}

    class RecordingConvex:
        def __init__(self, settings):
            pass

        async def command(self, command, **payload):
            updates.append((command, payload))
            return {"status": "verified"}

    monkeypatch.setattr(provider_api, "authorize", lambda *_: "magic:user")
    monkeypatch.setattr(provider_api, "details", fake_details)
    monkeypatch.setattr(provider_api, "with_secret", fake_with_secret)
    monkeypatch.setattr(provider_api, "ConvexWorkerClient", RecordingConvex)

    result = await provider_api.test_model(
        "connection-1",
        provider_api.ModelProbeRequest(model="nvidia/nemotron"),
        authorization=None,
        x_moeazi_subject=None,
    )

    assert result["compatible"] is True
    assert updates[0][0] == "updateProviderConnection"
    assert '"nvidia/nemotron"' in updates[0][1]["capabilitiesJson"]
