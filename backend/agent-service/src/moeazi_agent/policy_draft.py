import json
import re
from copy import deepcopy
from typing import Any


DEFAULT_POLICY = {
    "allowedMarkets": ["BTC-PERP", "ETH-PERP", "SOL-PERP", "LINK-PERP"],
    "allowedVenues": ["hyperliquid"],
    "maxOrderUsd": 25,
    "maxDailyVolumeUsd": 250,
    "maxLeverage": 5,
    "maxExposureUsd": 100,
    "maxDailyLossUsd": 50,
    "maxDailyDrawdownPct": 8,
    "maxSlippageBps": 75,
    "maxAnalysisAgeMs": 120_000,
    "minConfidence": 0.65,
    "minConsensus": 0.6,
    "cooldownSeconds": 60,
    "maxConcurrentPositions": 3,
    "requireStopLoss": True,
    "requireTakeProfit": False,
    "dailyCreditBudget": 10_000,
}
VENUES = {"hyperliquid", "lighter", "orderly", "gmx", "ostium", "uniswap"}


def draft_from_text(source: str, current: dict[str, Any] | None = None) -> tuple[dict, list[dict]]:
    """Conservative typed compiler; unmatched prose leaves safe defaults unchanged."""
    policy = deepcopy(current or DEFAULT_POLICY)
    patterns = {
        "maxOrderUsd": r"(?:max(?:imum)?\s+order)[^\d]{0,15}\$?([\d,.]+)",
        "maxDailyVolumeUsd": r"(?:daily\s+volume)[^\d]{0,15}\$?([\d,.]+)",
        "maxLeverage": r"(?:max(?:imum)?\s+leverage|leverage)[^\d]{0,15}([\d.]+)\s*x?",
        "maxExposureUsd": r"(?:max(?:imum)?\s+exposure)[^\d]{0,15}\$?([\d,.]+)",
        "maxDailyLossUsd": r"(?:daily\s+loss)[^\d]{0,15}\$?([\d,.]+)",
        "maxDailyDrawdownPct": r"(?:drawdown)[^\d]{0,15}([\d.]+)\s*%?",
        "maxSlippageBps": r"(?:slippage)[^\d]{0,15}([\d.]+)\s*(?:bps|basis)",
    }
    lowered = source.lower()
    for field, pattern in patterns.items():
        match = re.search(pattern, lowered)
        if match:
            value = float(match.group(1).replace(",", ""))
            policy[field] = int(value) if field.endswith("Bps") else value
    mentioned_venues = sorted(venue for venue in VENUES if re.search(rf"\b{venue}\b", lowered))
    if mentioned_venues:
        policy["allowedVenues"] = mentioned_venues
    markets = sorted(set(re.findall(r"\b(?:BTC|ETH|SOL|LINK)(?:[-/](?:USD|USDC|PERP))?\b", source.upper())))
    if markets:
        policy["allowedMarkets"] = [market if "-" in market else f"{market}-PERP" for market in markets]
    if "take profit" in lowered:
        policy["requireTakeProfit"] = "no take profit" not in lowered
    if "stop loss" in lowered:
        policy["requireStopLoss"] = "no stop loss" not in lowered
    _validate(policy)
    before = current or DEFAULT_POLICY
    diff = [{"field": key, "before": before.get(key), "after": value} for key, value in policy.items() if before.get(key) != value]
    return policy, diff


def _validate(policy: dict[str, Any]) -> None:
    if not policy["allowedMarkets"] or not set(policy["allowedVenues"]).issubset(VENUES):
        raise ValueError("Policy allowlists are invalid")
    if not 1 <= policy["maxLeverage"] <= 200: raise ValueError("maxLeverage outside allowed bounds")
    if not 0 <= policy["maxSlippageBps"] <= 5000: raise ValueError("maxSlippageBps outside allowed bounds")
    if not 0 < policy["maxDailyDrawdownPct"] <= 100: raise ValueError("drawdown outside allowed bounds")


def policy_json(policy: dict) -> str:
    return json.dumps(policy, separators=(",", ":"), sort_keys=True)
