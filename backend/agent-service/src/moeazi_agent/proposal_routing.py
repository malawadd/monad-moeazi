from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_DOWN

from .contracts import MarketSynthesis, ProtectiveExits, TradeProposal


def proposal_from_synthesis(
    synthesis: MarketSynthesis,
    reports: list[dict],
    account_id: str,
    policy: dict,
    max_spot_usdc_units: str | None = None,
) -> TradeProposal | None:
    if abs(synthesis.consensus) < 0.12 or synthesis.confidence < 0.35:
        return None
    evidence_ids = []
    for report in reports:
        for item in report.get("evidence", []):
            identifier = item.get("id")
            if identifier and identifier not in evidence_ids:
                evidence_ids.append(identifier)
    venues = policy.get("allowedVenues") or ["hyperliquid"]
    if venues == ["uniswap"]:
        # A spot wallet has no native short position. A bearish result is a hold,
        # never a sell of unowned inventory disguised as a new entry.
        if synthesis.consensus <= 0 or synthesis.market not in {
            "WETH-USDC", "ETH-USDC", "WETH/USDC", "ETH/USDC"}:
            return None
    try:
        size = min(Decimal(str(policy.get("maxOrderUsd", 25))), Decimal("25"))
        if venues == ["uniswap"] and max_spot_usdc_units is not None:
            if not max_spot_usdc_units.isdigit() or int(max_spot_usdc_units) <= 0:
                return None
            size = min(size, Decimal(max_spot_usdc_units) / Decimal(1_000_000))
            size = size.quantize(Decimal("0.000001"), rounding=ROUND_DOWN)
    except (InvalidOperation, ValueError):
        return None
    if not size.is_finite() or size <= 0:
        return None
    leverage = 1.0 if venues == ["uniswap"] else min(float(policy.get("maxLeverage", 2)), 2.0)
    return TradeProposal(
        account_id=account_id,
        market=synthesis.market,
        side="long" if synthesis.consensus > 0 else "short",
        candidate_venues=venues,
        size_usd=float(size),
        leverage=max(1.0, leverage),
        order_type="market",
        max_slippage_bps=min(int(policy.get("maxSlippageBps", 75)), 75),
        protective_exits=ProtectiveExits(),
        evidence_ids=evidence_ids[:30],
        analysis_id=synthesis.analysis_id,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=2),
    )
