from datetime import UTC, datetime

from .routing_contracts import (
    CostBreakdown,
    MarketListing,
    PublicVenueSnapshot,
    RouteRequest,
    RouteSide,
    VenueId,
    VenueRouteQuote,
)

PRIORITY = list(VenueId)
LABELS = {
    VenueId.HYPERLIQUID: ("Hyperliquid", "clob"),
    VenueId.LIGHTER: ("Lighter", "clob"),
    VenueId.ORDERLY: ("Orderly", "clob"),
    VenueId.GMX: ("GMX", "onchain"),
    VenueId.OSTIUM: ("Ostium", "onchain"),
}


def build_quote(request: RouteRequest, market: MarketListing, snapshot: PublicVenueSnapshot | None, venue: VenueId):
    label, kind = LABELS[venue]
    notional = request.margin_usd * request.leverage
    ready = venue in request.ready_venues
    base = dict(
        venue=venue, venue_label=label, kind=kind, account_ready=ready,
        notional_usd=round(notional, 2),
        max_leverage=snapshot.max_leverage if snapshot else market.max_leverage,
        fee_rate_bps=snapshot.taker_fee_bps if snapshot else 0,
        source=snapshot.source if snapshot else "none",
    )
    reason = exclusion(request, market, snapshot, venue, notional)
    if reason:
        return VenueRouteQuote(market_eligible=False, executable=False, reason=reason, **base)
    assert snapshot
    quantity = notional / snapshot.mid_price
    entry_side = request.side
    exit_side = RouteSide.SHORT if entry_side == RouteSide.LONG else RouteSide.LONG
    entry = sweep(snapshot.asks if entry_side == RouteSide.LONG else snapshot.bids, quantity)
    exit_price = sweep(snapshot.asks if exit_side == RouteSide.LONG else snapshot.bids, quantity)
    if entry is None or exit_price is None:
        return VenueRouteQuote(market_eligible=False, executable=False, reason="Insufficient public depth for this size.", **base)
    entry_slippage = slippage(entry_side, entry, snapshot.mid_price, quantity)
    exit_slippage = slippage(exit_side, exit_price, snapshot.mid_price, quantity)
    impact_bps = ((entry_slippage + exit_slippage) / notional) * 10_000
    if impact_bps > request.slippage_cap_bps:
        return VenueRouteQuote(market_eligible=False, executable=False, reason="Estimated round-trip impact exceeds the slippage cap.", **base)
    fees = round(notional * snapshot.taker_fee_bps / 10_000, 4)
    funding = round(
        notional * snapshot.funding_rate_hourly * (request.hold_time_hours or 0)
        * (1 if request.side == RouteSide.LONG else -1), 4,
    )
    costs = CostBreakdown(
        entry_fee_usd=fees, exit_fee_usd=fees,
        entry_slippage_usd=entry_slippage, exit_slippage_usd=exit_slippage,
        funding_usd=funding,
        total_cost_usd=round(fees * 2 + entry_slippage + exit_slippage + funding, 4),
    )
    fresh = max(0, int((datetime.now(UTC) - snapshot.observed_at).total_seconds() * 1000))
    setup = None if ready else f"Enable {label} for this strategy account."
    return VenueRouteQuote(
        market_eligible=True, executable=ready, setup_requirement=setup,
        mid_price=snapshot.mid_price, estimated_entry_price=entry,
        estimated_exit_price=exit_price, available_depth_usd=depth(snapshot, request.side),
        freshness_ms=fresh, costs=costs, **base,
    )


def exclusion(request, market, snapshot, venue, notional):
    if venue not in request.allowed_venues:
        return "Blocked by the account venue allowlist."
    if venue not in market.venues:
        return "Market is not listed on this venue."
    if not snapshot:
        return "Public quote is temporarily unavailable."
    if request.leverage > snapshot.max_leverage:
        return f"Leverage exceeds the {snapshot.max_leverage:g}x venue limit."
    if notional < snapshot.min_notional_usd:
        return f"Notional is below the ${snapshot.min_notional_usd:g} venue minimum."
    age = (datetime.now(UTC) - snapshot.observed_at).total_seconds()
    if age > 60:
        return "Public quote is stale."
    return None


def sweep(levels, quantity):
    remaining, total = quantity, 0.0
    for level in levels:
        filled = min(remaining, level.size)
        total += filled * level.price
        remaining -= filled
        if remaining <= 1e-12:
            return total / quantity
    return None


def slippage(side, fill, mid, quantity):
    delta = fill - mid if side == RouteSide.LONG else mid - fill
    return round(max(0, delta * quantity), 4)


def depth(snapshot, side):
    levels = snapshot.asks if side == RouteSide.LONG else snapshot.bids
    return round(sum(level.price * level.size for level in levels), 2)


def ranked(quotes, executable_only=False):
    candidates = [q for q in quotes if q.market_eligible and (q.executable or not executable_only)]
    return sorted(candidates, key=lambda q: (round(q.costs.total_cost_usd, 2), q.freshness_ms or 10**12, PRIORITY.index(q.venue)))
