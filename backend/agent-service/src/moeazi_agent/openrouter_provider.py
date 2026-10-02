import asyncio
import json
from typing import Any

import httpx
from pydantic import BaseModel, ValidationError

from .config import Settings
from .contracts import SignalReport, SynthesisDraft
from .costs import Usage
from .providers import (
    ProviderFailure,
    ProviderResponse,
    SignalProvider,
    _synthesis_prompt,
    specialist_prompt,
)
from .roles import Assignment
from .security import SYSTEM_BOUNDARY


def _response_format(model: type[BaseModel], name: str) -> dict:
    return {
        "type": "json_schema",
        "json_schema": {"name": name, "strict": True, "schema": model.model_json_schema()},
    }


def _routing_preferences(value: dict | None) -> dict:
    source = value or {}
    result: dict[str, Any] = {
        "sort": source.get("sort", "price"),
        "allow_fallbacks": bool(source.get("allowFallbacks", True)),
        "require_parameters": True,
        "data_collection": source.get("dataCollection", "deny"),
        "zdr": bool(source.get("zeroDataRetention", True)),
    }
    if source.get("allowedProviders"):
        result["only"] = source["allowedProviders"]
    if source.get("ignoredProviders"):
        result["ignore"] = source["ignoredProviders"]
    prompt = int(source.get("maxInputPriceMicrousdPerMillion") or 0)
    completion = int(source.get("maxOutputPriceMicrousdPerMillion") or 0)
    if prompt or completion:
        result["max_price"] = {
            "prompt": prompt / 1_000_000,
            "completion": completion / 1_000_000,
        }
    return result


class OpenRouterProvider(SignalProvider):
    name = "openrouter"

    def __init__(self, settings: Settings, api_key: str):
        self.settings = settings
        self.retries = settings.provider_retries
        self.client = httpx.AsyncClient(
            base_url=settings.openrouter_base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": settings.openrouter_http_referer,
                "X-OpenRouter-Title": settings.openrouter_app_title,
                "X-OpenRouter-Metadata": "enabled",
            },
            timeout=settings.provider_timeout_seconds,
        )

    async def analyze(self, assignment: Assignment, market: str, evidence: str) -> ProviderResponse:
        model = assignment.model
        if not model:
            raise ProviderFailure(self.name, "OpenRouter route requires an explicit model", retryable=False)
        body = self._body(
            model, specialist_prompt(assignment, market, evidence), SignalReport,
            "signal_report", assignment.max_output_tokens, assignment.provider_preferences,
        )
        payload = await self._request(body)
        report = self._validated(payload, SignalReport, {
            "provider": self.name, "model": model, "role": assignment.role.name,
            "horizon": assignment.role.horizon, "evidence": [],
        })
        return ProviderResponse(report, await self._usage(payload))

    async def synthesize(
        self, market: str, tier: str, step: str, materials: list[dict],
        model: str | None = None, max_output_tokens: int | None = None,
        reasoning_effort: str | None = None, provider_preferences: dict | None = None,
    ) -> ProviderResponse:
        if not model:
            raise ProviderFailure(self.name, "OpenRouter route requires an explicit model", retryable=False)
        body = self._body(
            model, _synthesis_prompt(market, tier, step, materials), SynthesisDraft,
            "synthesis_draft", max_output_tokens, provider_preferences,
        )
        if reasoning_effort and reasoning_effort != "none":
            body["reasoning"] = {"effort": reasoning_effort}
        payload = await self._request(body)
        return ProviderResponse(self._validated(payload, SynthesisDraft), await self._usage(payload))

    def _body(
        self, model: str, prompt: str, output: type[BaseModel], name: str,
        max_tokens: int | None, preferences: dict | None,
    ) -> dict:
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM_BOUNDARY},
                {"role": "user", "content": prompt},
            ],
            "response_format": _response_format(output, name),
            "provider": _routing_preferences(preferences),
            "max_tokens": max_tokens or self.settings.specialist_max_output_tokens,
            "stream": False,
        }

    async def _request(self, body: dict) -> dict:
        for attempt in range(self.retries + 1):
            try:
                response = await self.client.post("/chat/completions", json=body)
                if response.status_code in {401, 402, 403}:
                    detail = {
                        401: "OpenRouter key is invalid",
                        402: "OpenRouter balance is exhausted",
                        403: "OpenRouter rejected the configured privacy or routing policy",
                    }[response.status_code]
                    raise ProviderFailure(self.name, detail, retryable=False)
                if response.status_code in {408, 429, 500, 502, 503, 504, 529}:
                    raise ProviderFailure(self.name, f"OpenRouter HTTP {response.status_code}")
                response.raise_for_status()
                return response.json()
            except ProviderFailure as exc:
                if not exc.retryable or attempt >= self.retries:
                    raise
            except (httpx.HTTPError, ValueError) as exc:
                if attempt >= self.retries:
                    raise ProviderFailure(self.name, str(exc)) from exc
            await asyncio.sleep(min(2**attempt, 4))
        raise ProviderFailure(self.name, "OpenRouter retry loop exhausted")

    def _validated(self, payload: dict, model: type[BaseModel], overrides: dict | None = None):
        try:
            content = payload["choices"][0]["message"].get("content")
            if not content or not content.strip():
                raise ProviderFailure(self.name, "OpenRouter returned empty content")
            document = json.loads(content)
            if overrides:
                document.update(overrides)
            return model.model_validate(document)
        except ProviderFailure:
            raise
        except (KeyError, json.JSONDecodeError, ValidationError) as exc:
            raise ProviderFailure(self.name, f"OpenRouter returned invalid structured output: {exc}") from exc

    async def _usage(self, payload: dict) -> Usage:
        raw = payload.get("usage") or {}
        details = raw.get("prompt_tokens_details") or {}
        cost = raw.get("cost")
        cost_source = "provider_reported"
        if cost is None:
            cost = await self._generation_cost(payload.get("id"))
        if cost is None:
            cost_source = "rate_estimate"
        metadata = _routing_metadata(payload)
        return Usage(
            input_tokens=int(raw.get("prompt_tokens") or 0),
            cached_input_tokens=int(details.get("cached_tokens") or 0),
            output_tokens=int(raw.get("completion_tokens") or 0),
            provider_cost_microusd=round(float(cost) * 1_000_000) if cost is not None else None,
            cost_source=cost_source, routing_metadata=metadata,
        )

    async def _generation_cost(self, generation_id: str | None) -> float | None:
        if not generation_id:
            return None
        try:
            response = await self.client.get("/generation", params={"id": generation_id})
            response.raise_for_status()
            return (response.json().get("data") or {}).get("total_cost")
        except (httpx.HTTPError, ValueError):
            return None

    async def close(self) -> None:
        await self.client.aclose()


def _routing_metadata(payload: dict) -> dict:
    metadata = payload.get("openrouter_metadata") or {}
    endpoints = (metadata.get("endpoints") or {}).get("available") or []
    selected = next((item for item in endpoints if item.get("selected")), {})
    attempts = metadata.get("attempts") or []
    served_model = str(payload.get("model") or metadata.get("requested") or "")
    family = (
        served_model.split("/", 1)[0].lower()
        if metadata and selected.get("provider") and "/" in served_model else "unknown"
    )
    return {
        "generationId": payload.get("id"),
        "servedModel": served_model,
        "upstreamProvider": selected.get("provider"),
        "modelFamily": family,
        "routingStrategy": metadata.get("strategy"),
        "fallbackAttempts": max(0, int(metadata.get("attempt") or 1) - 1),
        "attempts": [
            {"provider": item.get("provider"), "model": item.get("model"), "status": item.get("status")}
            for item in attempts[:10]
        ],
        "upstreamUsesCustomerBilling": bool((payload.get("usage") or {}).get("is_byok")),
    }
