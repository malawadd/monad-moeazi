import json
import hashlib
from decimal import Decimal, InvalidOperation
from typing import Literal

import httpx
from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field
from redis.asyncio import Redis

from .config import Settings


class CompatibilityProbe(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision_summary: str = Field(min_length=2, max_length=160)
    key_factors: list[str] = Field(min_length=1, max_length=3)
    confidence: float = Field(ge=0, le=1)


KNOWN_PRICES = {
    "gpt-5.6-sol": (5_000_000, 500_000, 30_000_000),
    "gpt-5.6-terra": (2_500_000, 250_000, 15_000_000),
    "gpt-5.6-luna": (1_000_000, 100_000, 6_000_000),
    "gpt-5.4-mini": (0, 0, 0),
    "deepseek-v4-flash": (140_000, 2_800, 280_000),
    "deepseek-v4-pro": (435_000, 3_625, 870_000),
}


ProviderName = Literal["openai", "deepseek", "openrouter"]


def model_view(model_id: str, source: dict | None = None) -> dict:
    source = source or {}
    rates = KNOWN_PRICES.get(model_id)
    pricing = source.get("pricing") or {}
    input_rate = _price(pricing.get("prompt")) if pricing else (rates[0] if rates else 0)
    cached_rate = _price(pricing.get("input_cache_read")) if pricing else (rates[1] if rates else 0)
    output_rate = _price(pricing.get("completion")) if pricing else (rates[2] if rates else 0)
    return {
        "id": model_id,
        "name": source.get("name") or model_id,
        "author": model_id.split("/", 1)[0] if "/" in model_id else "",
        "contextLength": int(source.get("context_length") or 0),
        "supportedParameters": source.get("supported_parameters") or [],
        "pricingKnown": bool(input_rate or output_rate),
        "inputPriceMicrousdPerMillion": input_rate,
        "cachedInputPriceMicrousdPerMillion": cached_rate or input_rate,
        "outputPriceMicrousdPerMillion": output_rate,
        "maximumInputPriceMicrousdPerMillion": input_rate,
        "maximumOutputPriceMicrousdPerMillion": output_rate,
        "upstreamProviders": [],
    }


def _price(value) -> int:
    try:
        return max(0, round(Decimal(str(value or "0")) * Decimal("1000000000000")))
    except InvalidOperation:
        return 0


async def list_models(provider: ProviderName, api_key: str, settings: Settings) -> list[dict]:
    if provider == "openai":
        client = AsyncOpenAI(api_key=api_key, timeout=settings.provider_timeout_seconds)
        try:
            page = await client.models.list()
            ids = [item.id for item in page.data]
        finally:
            await client.close()
    elif provider == "deepseek":
        async with httpx.AsyncClient(
            base_url=settings.deepseek_base_url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=settings.provider_timeout_seconds,
        ) as client:
            response = await client.get("/models")
            response.raise_for_status()
            ids = [str(item["id"]) for item in response.json().get("data", []) if item.get("id")]
        return [model_view(item) for item in sorted(set(ids))[:200]]
    else:
        return await _openrouter_catalog(api_key, settings)
    return [model_view(item) for item in sorted(set(ids))[:200]]


async def _openrouter_catalog(api_key: str, settings: Settings) -> list[dict]:
    cache_key = f"openrouter:catalog:v2:{hashlib.sha256(api_key.encode()).hexdigest()[:16]}"
    redis = Redis.from_url(settings.redis_url)
    try:
        cached = await redis.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        cached = None
    finally:
        await redis.aclose()
    async with _openrouter_client(api_key, settings) as client:
        response = await client.get(
            "/models/user", params={"output_modalities": "text"},
        )
        response.raise_for_status()
        models = [
            model_view(str(item["id"]), item)
            for item in response.json().get("data", [])
            if item.get("id") and "text" in (item.get("architecture") or {}).get("output_modalities", ["text"])
        ]
    models.sort(key=lambda item: (item["author"], item["name"]))
    redis = Redis.from_url(settings.redis_url)
    try:
        await redis.setex(cache_key, 300, json.dumps(models, separators=(",", ":")))
    except Exception:
        pass
    finally:
        await redis.aclose()
    return models


def search_models(models: list[dict], query: str) -> list[dict]:
    needle = query.strip().lower()
    if not needle:
        return models

    def rank(item: dict) -> tuple[int, str]:
        model_id = str(item.get("id") or "").lower()
        name = str(item.get("name") or "").lower()
        author = str(item.get("author") or "").lower()
        if model_id == needle:
            score = 0
        elif name == needle:
            score = 1
        elif author == needle:
            score = 2
        elif model_id.startswith(needle):
            score = 3
        elif name.startswith(needle):
            score = 4
        elif author.startswith(needle):
            score = 5
        elif needle in model_id:
            score = 6
        elif needle in name:
            score = 7
        elif needle in author:
            score = 8
        else:
            score = 99
        return score, model_id

    ranked = [(rank(item), item) for item in models]
    return [item for score, item in sorted(ranked, key=lambda pair: pair[0]) if score[0] < 99]


def _openrouter_client(api_key: str, settings: Settings) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=settings.openrouter_base_url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": settings.openrouter_http_referer,
            "X-OpenRouter-Title": settings.openrouter_app_title,
        },
        timeout=settings.provider_timeout_seconds,
    )


async def openrouter_model_details(model: str, api_key: str, settings: Settings) -> dict:
    author, slug = model.split("/", 1)
    async with _openrouter_client(api_key, settings) as client:
        response = await client.get(f"/models/{author}/{slug}/endpoints")
        response.raise_for_status()
        payload = response.json().get("data") or {}
    endpoints = [
        item for item in payload.get("endpoints", [])
        if "structured_outputs" in (item.get("supported_parameters") or [])
    ]
    if not endpoints:
        raise RuntimeError("No upstream endpoint supports strict structured output")
    input_prices = [_price((item.get("pricing") or {}).get("prompt")) for item in endpoints]
    cached_prices = [_price((item.get("pricing") or {}).get("input_cache_read")) for item in endpoints]
    output_prices = [_price((item.get("pricing") or {}).get("completion")) for item in endpoints]
    return {
        "id": model, "name": payload.get("name") or model,
        "author": author, "contextLength": int(payload.get("context_length") or 0),
        "pricingKnown": any(input_prices) or any(output_prices),
        "inputPriceMicrousdPerMillion": min(input_prices),
        "cachedInputPriceMicrousdPerMillion": min([item for item in cached_prices if item] or input_prices),
        "outputPriceMicrousdPerMillion": min(output_prices),
        "maximumInputPriceMicrousdPerMillion": max(input_prices),
        "maximumOutputPriceMicrousdPerMillion": max(output_prices),
        "supportedParameters": ["structured_outputs", "response_format"],
        "upstreamProviders": sorted({
            str(item.get("provider_name")) for item in endpoints if item.get("provider_name")
        }),
        "pricingVersion": "openrouter-live-v1",
    }


async def probe_model(
    provider: ProviderName, model: str, api_key: str, settings: Settings,
) -> dict:
    prompt = "Return a short structured compatibility result about BTC market data. Do not call tools."
    if provider == "openai":
        client = AsyncOpenAI(api_key=api_key, timeout=settings.provider_timeout_seconds)
        try:
            response = await client.responses.parse(
                model=model, instructions="Return only the requested typed result.", input=prompt,
                text_format=CompatibilityProbe, max_output_tokens=128,
            )
            if response.output_parsed is None:
                raise RuntimeError("Model returned no typed output")
            result = response.output_parsed.model_dump()
            usage = getattr(response, "usage", None)
            result["usage"] = {
                "inputTokens": int(getattr(usage, "input_tokens", 0) or 0),
                "outputTokens": int(getattr(usage, "output_tokens", 0) or 0),
            }
        finally:
            await client.close()
        return result
    schema = CompatibilityProbe.model_json_schema()
    if provider == "openrouter":
        detail = await openrouter_model_details(model, api_key, settings)
        async with _openrouter_client(api_key, settings) as client:
            response = await client.post("/chat/completions", json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "Return only the requested typed result. Do not call tools."},
                    {"role": "user", "content": prompt},
                ],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {"name": "compatibility_probe", "strict": True, "schema": schema},
                },
                "provider": {
                    "sort": "price", "allow_fallbacks": True, "require_parameters": True,
                    "data_collection": "deny", "zdr": True,
                    "max_price": {
                        "prompt": detail["maximumInputPriceMicrousdPerMillion"] / 1_000_000,
                        "completion": detail["maximumOutputPriceMicrousdPerMillion"] / 1_000_000,
                    },
                },
                "max_tokens": 128,
            })
            response.raise_for_status()
            payload = response.json()
        content = payload["choices"][0]["message"].get("content")
        if not content:
            raise RuntimeError("Model returned no typed output")
        result = CompatibilityProbe.model_validate_json(content).model_dump()
        usage = payload.get("usage") or {}
        result["usage"] = {
            "inputTokens": int(usage.get("prompt_tokens") or 0),
            "outputTokens": int(usage.get("completion_tokens") or 0),
            "costMicrousd": round(float(usage.get("cost") or 0) * 1_000_000),
        }
        result["model"] = detail
        return result
    async with httpx.AsyncClient(
        base_url=settings.deepseek_base_url,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=settings.provider_timeout_seconds,
    ) as client:
        response = await client.post("/chat/completions", json={
            "model": model,
            "messages": [
                {"role": "system", "content": "Return JSON matching the supplied schema."},
                {"role": "user", "content": f"{prompt}\nSchema: {json.dumps(schema)}"},
            ],
            "response_format": {"type": "json_object"}, "max_tokens": 128,
        })
        response.raise_for_status()
        payload = response.json()
    content = payload["choices"][0]["message"].get("content")
    if not content:
        raise RuntimeError("Model returned no typed output")
    result = CompatibilityProbe.model_validate_json(content).model_dump()
    usage = payload.get("usage") or {}
    result["usage"] = {
        "inputTokens": int(usage.get("prompt_tokens") or 0),
        "outputTokens": int(usage.get("completion_tokens") or 0),
    }
    return result
