from datetime import datetime, timezone
from typing import Any

from .config import Settings
from .contracts import ExecutionDecision, TradeProposal
from .credentials import KeyWrapper
from .policy import AutomationPolicy, RiskContext, evaluate_policy
from .venues import CertificationBlockedAdapter, HyperliquidAdapter, UniswapTradingApiAdapter, VenueAdapter


class ExecutionGateway:
    def __init__(self, settings: Settings, key_wrapper: KeyWrapper | None = None):
        certified = settings.certified_venue_set
        self.adapters: dict[str, VenueAdapter] = {
            venue: CertificationBlockedAdapter(venue) for venue in ("hyperliquid", "lighter", "orderly", "gmx", "ostium")
        }
        self.adapters["hyperliquid"] = HyperliquidAdapter(
            "https://api.hyperliquid.xyz",
            settings.live_execution_enabled and "hyperliquid" in certified,
        )
        self.adapters["uniswap"] = UniswapTradingApiAdapter(
            settings.uniswap_api_url, settings.uniswap_api_key.get_secret_value(),
            settings.live_execution_enabled and "uniswap" in certified,
        )
        self.live_enabled = settings.live_execution_enabled
        self.certified = certified
        self.key_wrapper = key_wrapper

    async def quote(self, venue: str, request: dict[str, Any]) -> Any:
        if venue not in self.adapters:
            raise RuntimeError(f"Unsupported venue: {venue}")
        return await self.adapters[venue].quote(request)

    async def preflight(
        self, venue: str, proposal: TradeProposal, policy: AutomationPolicy,
        context: RiskContext, quote_request: dict[str, Any], idempotency_key: str,
    ) -> tuple[ExecutionDecision, Any, Any]:
        adapter = self.adapters[venue]
        health = await adapter.health()
        quote = await adapter.quote(quote_request)
        fresh_context = context.model_copy(update={"venue_healthy": health.healthy})
        decision = evaluate_policy(policy, proposal, fresh_context, quote.reference, idempotency_key)
        if quote.expires_at <= datetime.now(timezone.utc):
            decision = decision.model_copy(update={"result": "fail"})
        return decision, quote, health

    async def execute(
        self, venue: str, request: dict[str, Any], decision: ExecutionDecision,
        wrapped_credential: str, account_context: str,
    ) -> dict[str, Any]:
        if decision.result != "pass": raise RuntimeError("Policy decision rejected execution")
        if not self.live_enabled or venue not in self.certified:
            raise RuntimeError(f"{venue} live execution is not enabled and certified")
        if not self.key_wrapper: raise RuntimeError("Credential KMS adapter is unavailable")
        health = await self.adapters[venue].health()
        if not health.healthy or not health.live_submission_enabled:
            raise RuntimeError(health.reason or f"{venue} native submission is unavailable")
        credential = bytearray(self.key_wrapper.unwrap(wrapped_credential, account_context.encode()))
        try:
            return await self.adapters[venue].place(request, bytes(credential))
        finally:
            for index in range(len(credential)): credential[index] = 0

    async def execute_or_simulate(
        self,
        venue: str,
        request: dict[str, Any],
        decision: ExecutionDecision,
        idempotency_key: str,
        wrapped_credential: str | None = None,
        account_context: str | None = None,
    ) -> dict[str, Any]:
        if decision.result != "pass":
            raise RuntimeError("Policy decision rejected execution")
        if not self.live_enabled or venue not in self.certified:
            return {
                "status": "simulated",
                "venue": venue,
                "idempotencyKey": idempotency_key,
                "reason": "Live execution or venue certification gate is closed",
            }
        if not wrapped_credential or not account_context:
            raise RuntimeError("Encrypted credential envelope is required")
        return await self.execute(
            venue, request, decision, wrapped_credential, account_context,
        )

    async def credential_mutation(
        self,
        operation: str,
        venue: str,
        request: dict[str, Any],
        wrapped_credential: str,
        account_context: str,
    ) -> dict[str, Any]:
        if not self.live_enabled or venue not in self.certified:
            raise RuntimeError(f"{venue} live execution is not enabled and certified")
        if not self.key_wrapper:
            raise RuntimeError("Credential KMS adapter is unavailable")
        adapter = self.adapters[venue]
        credential = bytearray(self.key_wrapper.unwrap(wrapped_credential, account_context.encode()))
        try:
            method = getattr(adapter, operation)
            return await method(request, bytes(credential))
        finally:
            for index in range(len(credential)):
                credential[index] = 0
