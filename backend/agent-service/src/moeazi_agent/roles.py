from dataclasses import dataclass, replace
from typing import Literal


Provider = Literal["openai", "deepseek", "openrouter"]


@dataclass(frozen=True)
class RoleSpec:
    name: str
    horizon: Literal["minutes", "hours", "days", "weeks"]
    critical: bool = False
    directional_or_risk: bool = False


ROLES = (
    RoleSpec("technical_trend", "hours", directional_or_risk=True),
    RoleSpec("liquidity", "minutes", critical=True, directional_or_risk=True),
    RoleSpec("derivatives", "hours", critical=True, directional_or_risk=True),
    RoleSpec("on_chain", "days"),
    RoleSpec("news", "days"),
    RoleSpec("social", "hours"),
    RoleSpec("cross_venue_basis", "minutes", critical=True, directional_or_risk=True),
    RoleSpec("volatility_liquidations", "minutes", critical=True, directional_or_risk=True),
    RoleSpec("whale_flow", "hours", directional_or_risk=True),
    RoleSpec("macro_correlation", "days"),
    RoleSpec("execution_quality", "minutes"),
    RoleSpec("portfolio_exposure", "hours", directional_or_risk=True),
    RoleSpec("short_horizon", "minutes", directional_or_risk=True),
    RoleSpec("swing_horizon", "days", directional_or_risk=True),
    RoleSpec("bull_case", "days", directional_or_risk=True),
    RoleSpec("bear_case", "days", directional_or_risk=True),
    RoleSpec("range_regime", "hours"),
    RoleSpec("catalyst", "days"),
    RoleSpec("data_quality_skeptic", "hours"),
    RoleSpec("market_integrity", "minutes"),
)


@dataclass(frozen=True)
class Assignment:
    role: RoleSpec
    provider: Provider
    model: str | None = None
    credential_source: str = "platform"
    max_output_tokens: int | None = None
    reasoning_effort: str | None = None
    provider_preferences: dict | None = None
    instructions: str = ""


def assignments_for_tier(tier: str) -> list[Assignment]:
    if tier not in {"focus", "pro", "max"}:
        raise ValueError(f"Unsupported tier: {tier}")
    count = {"focus": 6, "pro": 12, "max": 20}[tier]
    selected = ROLES[:count]
    result = [Assignment(role, "openai" if index % 2 == 0 else "deepseek") for index, role in enumerate(selected)]
    if tier == "pro":
        result.extend(Assignment(item.role, "deepseek" if item.provider == "openai" else "openai") for item in result.copy() if item.role.critical)
    if tier == "max":
        doubled = [item for item in result if item.role.directional_or_risk][:10]
        result.extend(Assignment(item.role, "deepseek" if item.provider == "openai" else "openai") for item in doubled)
    return result


def assignments_for_configuration(tier: str, selections: list[dict]) -> list[Assignment]:
    expected = {"focus": 6, "pro": 12, "max": 20}.get(tier)
    if expected is None or len(selections) != len(ROLES):
        raise ValueError("Saved specialist composition is invalid")
    by_name = {item.name: item for item in ROLES}
    if {item.get("id") for item in selections} != set(by_name):
        raise ValueError("Saved specialist identities are invalid")
    enabled = [item for item in selections if item.get("enabled") is True]
    if len(enabled) != expected:
        raise ValueError("Saved specialist count does not match the tier")
    required = {"liquidity", "derivatives"}
    if tier != "focus":
        required |= {"cross_venue_basis", "volatility_liquidations"}
    if not required.issubset({item["id"] for item in enabled}):
        raise ValueError("A critical specialist is missing")
    result = []
    for index, item in enumerate(enabled):
        horizon = item.get("horizon")
        instructions = item.get("instructions", "")
        if horizon not in {"minutes", "hours", "days", "weeks"} or not isinstance(instructions, str) or len(instructions) > 1_000:
            raise ValueError("Saved specialist horizon or instructions are invalid")
        role = replace(by_name[item["id"]], horizon=horizon)
        result.append(Assignment(role, "openai" if index % 2 == 0 else "deepseek", instructions=instructions))
    if tier == "pro":
        result.extend(replace(item, provider="deepseek" if item.provider == "openai" else "openai")
            for item in result.copy() if item.role.critical)
    if tier == "max":
        doubled = [item for item in result if item.role.directional_or_risk][:10]
        result.extend(replace(item, provider="deepseek" if item.provider == "openai" else "openai") for item in doubled)
    return result


def lite_assignments() -> list[Assignment]:
    return [
        Assignment(ROLES[0], "deepseek"),
        Assignment(ROLES[1], "deepseek"),
    ]


def required_synthesis_steps(tier: str) -> tuple[str, ...]:
    return {
        "focus": ("synthesis",),
        "pro": ("critic", "synthesis"),
        "max": ("synthesis_primary", "synthesis_challenger", "arbiter"),
    }[tier]
