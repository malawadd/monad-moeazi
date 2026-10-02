from dataclasses import replace
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .roles import Assignment


class OpenRouterPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    sort: str = "price"
    allow_fallbacks: bool = Field(default=True, alias="allowFallbacks")
    allowed_providers: list[str] = Field(default_factory=list, alias="allowedProviders", max_length=20)
    ignored_providers: list[str] = Field(default_factory=list, alias="ignoredProviders", max_length=20)
    data_collection: str = Field(default="deny", alias="dataCollection")
    zero_data_retention: bool = Field(default=True, alias="zeroDataRetention")

    @model_validator(mode="after")
    def validate_preferences(self):
        if self.sort not in {"price", "latency", "throughput"}:
            raise ValueError("Unsupported OpenRouter sort")
        if self.data_collection not in {"allow", "deny"}:
            raise ValueError("Unsupported OpenRouter data policy")
        if self.allowed_providers and self.ignored_providers:
            overlap = set(self.allowed_providers) & set(self.ignored_providers)
            if overlap:
                raise ValueError("OpenRouter providers cannot be both allowed and ignored")
        providers = self.allowed_providers + self.ignored_providers
        if any(
            not item or len(item) > 80
            or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._/-" for character in item)
            for item in providers
        ):
            raise ValueError("Invalid OpenRouter provider slug")
        return self


class ModelRoute(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    slot: str
    provider: str
    model: str
    credential_source: str = Field(alias="credentialSource")
    connection_id: str | None = Field(default=None, alias="connectionId")
    max_output_tokens: int = Field(alias="maxOutputTokens", ge=128, le=8_192)
    reasoning_effort: str | None = Field(default=None, alias="reasoningEffort")
    input_price: int = Field(alias="inputPriceMicrousdPerMillion", ge=0)
    cached_input_price: int = Field(alias="cachedInputPriceMicrousdPerMillion", ge=0)
    output_price: int = Field(alias="outputPriceMicrousdPerMillion", ge=0)
    estimated_input_price: int | None = Field(
        default=None, alias="estimatedInputPriceMicrousdPerMillion", ge=0,
    )
    estimated_output_price: int | None = Field(
        default=None, alias="estimatedOutputPriceMicrousdPerMillion", ge=0,
    )
    openrouter: OpenRouterPreferences | None = None


class ModelRouting(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    schema_version: int = Field(alias="schemaVersion")
    routes: list[ModelRoute]

    @model_validator(mode="after")
    def validate_routes(self):
        if self.schema_version not in {1, 2}:
            raise ValueError("Unsupported model-routing schema")
        slots = {item.slot for item in self.routes}
        if not {"specialist_default", "synthesis"}.issubset(slots):
            raise ValueError("Specialist and synthesis routes are required")
        credentials: dict[str, str] = {}
        for route in self.routes:
            if route.provider not in {"openai", "deepseek", "openrouter"}:
                raise ValueError("Unsupported provider")
            if route.credential_source not in {"platform", "byok"}:
                raise ValueError("Unsupported credential source")
            if route.credential_source == "byok" and not route.connection_id:
                raise ValueError("BYOK route requires a connection")
            if route.provider == "openrouter":
                if route.openrouter is None:
                    route.openrouter = OpenRouterPreferences()
            elif route.openrouter is not None:
                raise ValueError("OpenRouter preferences require the OpenRouter provider")
            key = f"{route.credential_source}:{route.connection_id or 'platform'}"
            if route.provider in credentials and credentials[route.provider] != key:
                raise ValueError("Each provider must use one credential per configuration")
            credentials[route.provider] = key
        return self

    def route(self, slot: str) -> ModelRoute:
        exact = next((item for item in self.routes if item.slot == slot), None)
        legacy = {
            "synthesis_primary": "openai_synthesis",
            "synthesis_challenger": "deepseek_synthesis",
        }.get(slot)
        if not exact and legacy:
            exact = next((item for item in self.routes if item.slot == legacy), None)
        if exact:
            return exact
        fallback = "specialist_default" if slot.startswith("role:") else "synthesis"
        return next(item for item in self.routes if item.slot == fallback)


def provider_preferences(route: ModelRoute) -> dict | None:
    if not route.openrouter:
        return None
    preferences = route.openrouter.model_dump(by_alias=True)
    preferences["maxInputPriceMicrousdPerMillion"] = route.input_price
    preferences["maxOutputPriceMicrousdPerMillion"] = route.output_price
    return preferences


def routed_assignments(assignments: list[Assignment], routing: ModelRouting | None) -> list[Assignment]:
    if not routing:
        return assignments
    return [
        replace(
            item,
            provider=routing.route(f"role:{item.role.name}").provider,
            model=routing.route(f"role:{item.role.name}").model,
            credential_source=routing.route(f"role:{item.role.name}").credential_source,
            max_output_tokens=routing.route(f"role:{item.role.name}").max_output_tokens,
            reasoning_effort=routing.route(f"role:{item.role.name}").reasoning_effort,
            provider_preferences=provider_preferences(routing.route(f"role:{item.role.name}")),
        )
        for item in assignments
    ]


def call_cost(route: ModelRoute, usage: Any) -> int:
    if route.credential_source != "byok" and route.provider != "openrouter":
        return 0
    reported = getattr(usage, "provider_cost_microusd", None)
    if reported is not None:
        return max(0, int(reported))
    cached = min(max(0, usage.cached_input_tokens), max(0, usage.input_tokens))
    uncached = max(0, usage.input_tokens - cached)
    return round((
        uncached * route.input_price + cached * route.cached_input_price
        + max(0, usage.output_tokens) * route.output_price
    ) / 1_000_000)


def call_credits(route: ModelRoute, kind: str) -> int:
    if route.credential_source == "platform":
        return 3 if kind == "specialist" else 9 if kind == "arbiter" else 7
    return 1 if kind == "specialist" else 3 if kind == "arbiter" else 2


def route_estimate(tier: str, assignments: list[Assignment], routing: ModelRouting | None) -> dict:
    if not routing:
        from .credits import estimated_credits
        return {"credits": estimated_credits(tier), "provider_cost_microusd": 0}
    specialist = routed_assignments(assignments, routing)
    steps = {
        "focus": ["synthesis"],
        "pro": ["critic", "synthesis"],
        "max": ["synthesis_primary", "synthesis_challenger", "arbiter"],
    }[tier]
    calls = [(routing.route(f"role:{item.role.name}"), "specialist") for item in specialist]
    calls.extend((routing.route(step), "arbiter" if step == "arbiter" else "synthesis") for step in steps)
    estimated = sum(
        round((
            (route.estimated_input_price if route.estimated_input_price is not None else route.input_price) * 2_500
            + (route.estimated_output_price if route.estimated_output_price is not None else route.output_price)
            * route.max_output_tokens
        ) / 1_000_000)
        for route, _ in calls if route.credential_source == "byok" or route.provider == "openrouter"
    )
    maximum = sum(
        round((route.input_price * 2_500 + route.output_price * route.max_output_tokens) / 1_000_000)
        for route, _ in calls if route.credential_source == "byok" or route.provider == "openrouter"
    )
    return {
        "credits": sum(call_credits(route, kind) for route, kind in calls),
        "provider_cost_microusd": maximum,
        "estimated_provider_cost_microusd": estimated,
    }
