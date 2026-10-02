from dataclasses import asdict, dataclass

from .roles import assignments_for_tier, required_synthesis_steps


PRICING_VERSION = "deepseek-v4-2026-04-24"
PRICE_SOURCE = "https://api-docs.deepseek.com/quick_start/pricing"


@dataclass(frozen=True)
class ModelPrice:
    input_miss_per_million: float
    input_hit_per_million: float
    output_per_million: float


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    provider_cost_microusd: int | None = None
    cost_source: str = "rate_estimate"
    routing_metadata: dict | None = None


DEEPSEEK_PRICES = {
    "deepseek-v4-flash": ModelPrice(0.14, 0.0028, 0.28),
    "deepseek-v4-pro": ModelPrice(0.435, 0.003625, 0.87),
}

SPECIALIST_INPUT_TOKENS = 2_500
SPECIALIST_MAX_INPUT_TOKENS = 4_000
SPECIALIST_OUTPUT_TOKENS = 700
SYNTHESIS_INPUT_TOKENS = {"focus": 3_500, "pro": 6_000, "max": 9_000}
SYNTHESIS_OUTPUT_TOKENS = 1_200


def deepseek_cost(model: str, usage: Usage) -> float | None:
    price = DEEPSEEK_PRICES.get(model)
    if not price:
        return None
    cached = min(max(0, usage.cached_input_tokens), max(0, usage.input_tokens))
    uncached = max(0, usage.input_tokens - cached)
    return round((
        uncached * price.input_miss_per_million
        + cached * price.input_hit_per_million
        + max(0, usage.output_tokens) * price.output_per_million
    ) / 1_000_000, 8)


def tier_estimate(tier: str) -> dict:
    specialist_calls = len(assignments_for_tier(tier))
    synthesis_calls = len(required_synthesis_steps(tier))
    synthesis_input = SYNTHESIS_INPUT_TOKENS[tier]
    input_tokens = specialist_calls * SPECIALIST_INPUT_TOKENS + synthesis_calls * synthesis_input
    output_tokens = specialist_calls * SPECIALIST_OUTPUT_TOKENS + synthesis_calls * SYNTHESIS_OUTPUT_TOKENS
    specialist_cost = deepseek_cost("deepseek-v4-flash", Usage(
        input_tokens=specialist_calls * SPECIALIST_INPUT_TOKENS,
        output_tokens=specialist_calls * SPECIALIST_OUTPUT_TOKENS,
    )) or 0
    synthesis_cost = deepseek_cost("deepseek-v4-pro", Usage(
        input_tokens=synthesis_calls * synthesis_input,
        output_tokens=synthesis_calls * SYNTHESIS_OUTPUT_TOKENS,
    )) or 0
    estimated = specialist_cost + synthesis_cost
    synthesis_max_input = specialist_calls * SPECIALIST_OUTPUT_TOKENS + synthesis_calls * SYNTHESIS_OUTPUT_TOKENS + 3_000
    maximum = (
        deepseek_cost("deepseek-v4-flash", Usage(
            input_tokens=specialist_calls * SPECIALIST_MAX_INPUT_TOKENS,
            output_tokens=specialist_calls * SPECIALIST_OUTPUT_TOKENS,
        )) or 0
    ) + (
        deepseek_cost("deepseek-v4-pro", Usage(
            input_tokens=synthesis_calls * synthesis_max_input,
            output_tokens=synthesis_calls * SYNTHESIS_OUTPUT_TOKENS,
        )) or 0
    )
    return {
        "pricingVersion": PRICING_VERSION,
        "priceSource": PRICE_SOURCE,
        "currency": "USD",
        "specialistCalls": specialist_calls,
        "synthesisCalls": synthesis_calls,
        "totalCalls": specialist_calls + synthesis_calls,
        "estimatedInputTokens": input_tokens,
        "estimatedOutputTokens": output_tokens,
        "estimatedTotalTokens": input_tokens + output_tokens,
        "estimatedCostUsd": round(estimated, 6),
        "estimatedCostMicrousd": round(estimated * 1_000_000),
        "maximumCostUsd": round(maximum, 6),
        "assumptions": [
            "DeepSeek V4 non-thinking mode",
            "Eight recent evidence items maximum",
            "700 specialist and 1,200 synthesis output-token caps",
            "Maximum is a conservative capped-output prompt bound; retries are not user-billed",
        ],
        "rates": {name: asdict(price) for name, price in DEEPSEEK_PRICES.items()},
    }
