from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncEngine

from .config import Settings
from .model_routing import ModelRouting
from .provider_credentials import ProviderSecretVault, zero_secret
from .providers import DeepSeekProvider, OpenAIProvider, SignalProvider
from .openrouter_provider import OpenRouterProvider


@dataclass
class ProviderBundle:
    providers: dict[str, SignalProvider]
    routing: ModelRouting | None

    async def close(self) -> None:
        seen: set[int] = set()
        for provider in self.providers.values():
            if id(provider) in seen:
                continue
            seen.add(id(provider))
            await provider.close()


async def build_provider_bundle(
    settings: Settings, engine: AsyncEngine, configuration: dict | None,
) -> ProviderBundle:
    if not configuration:
        deepseek = DeepSeekProvider(settings)
        providers = (
            {"openai": deepseek, "deepseek": deepseek}
            if settings.provider_mode == "deepseek_only"
            else {"openai": OpenAIProvider(settings), "deepseek": deepseek}
        )
        return ProviderBundle(providers, None)

    routing = ModelRouting.model_validate(configuration["routes"])
    connection_map = {item["id"]: item for item in configuration.get("connections", [])}
    vault = ProviderSecretVault(settings, engine)
    providers: dict[str, SignalProvider] = {}
    for provider_name in {route.provider for route in routing.routes}:
        route = next(item for item in routing.routes if item.provider == provider_name)
        api_key = None
        secret = None
        if route.credential_source == "byok":
            connection = connection_map.get(route.connection_id or "")
            if not connection or connection.get("status") != "verified":
                raise RuntimeError(f"{provider_name} BYOK connection is unavailable")
            secret = await vault.retrieve(connection["secretRef"])
            api_key = secret.decode()
        try:
            if provider_name == "openai":
                providers[provider_name] = OpenAIProvider(settings, api_key)
            elif provider_name == "deepseek":
                providers[provider_name] = DeepSeekProvider(settings, api_key)
            elif api_key or settings.openrouter_api_key.get_secret_value():
                providers[provider_name] = OpenRouterProvider(
                    settings, api_key or settings.openrouter_api_key.get_secret_value())
            else:
                raise RuntimeError("OpenRouter credential is unavailable")
        finally:
            if secret is not None:
                zero_secret(secret)
            api_key = None
    return ProviderBundle(providers, routing)
