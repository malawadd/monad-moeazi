from datetime import UTC, datetime, timedelta

from moeazi_agent.routing_contracts import (
    MarketListing,
    PublicVenueSnapshot,
    RouteRequest,
    VenueId,
    VenueLevel,
)
from moeazi_agent.routing_math import build_quote, ranked
from moeazi_agent.routing_adapters import PublicRoutingAdapters, canonical_market, leverage_from_margin_fraction


def snapshot(venue: VenueId, fee_bps: float = 1, observed_at=None):
    return PublicVenueSnapshot(
        venue=venue,
        market_id="BTC",
        mid_price=100,
        bid_price=99.99,
        ask_price=100.01,
        bids=[VenueLevel(price=99.99, size=100)],
        asks=[VenueLevel(price=100.01, size=100)],
        max_leverage=50,
        taker_fee_bps=fee_bps,
        observed_at=observed_at or datetime.now(UTC),
        source="test",
    )


def request(ready=None, override=None):
    return RouteRequest(
        market_id="BTC", side="long", margin_usd=100, leverage=5,
        slippage_cap_bps=75, ready_venues=ready or [], override_venue=override,
    )


MARKET = MarketListing(
    market_id="BTC", label="BTC Perp", base_symbol="BTC", max_leverage=50,
    venues=[VenueId.HYPERLIQUID, VenueId.LIGHTER],
)


def test_cheapest_public_venue_can_require_setup_while_runner_up_is_executable():
    route = request([VenueId.HYPERLIQUID])
    lighter = build_quote(route, MARKET, snapshot(VenueId.LIGHTER, fee_bps=0), VenueId.LIGHTER)
    hyperliquid = build_quote(route, MARKET, snapshot(VenueId.HYPERLIQUID, fee_bps=4.5), VenueId.HYPERLIQUID)
    assert ranked([lighter, hyperliquid])[0].venue == VenueId.LIGHTER
    assert ranked([lighter, hyperliquid], executable_only=True)[0].venue == VenueId.HYPERLIQUID
    assert lighter.setup_requirement == "Enable Lighter for this strategy account."


def test_stale_and_unlisted_quotes_are_excluded():
    route = request([VenueId.HYPERLIQUID])
    stale = snapshot(VenueId.HYPERLIQUID, observed_at=datetime.now(UTC) - timedelta(minutes=2))
    quote = build_quote(route, MARKET, stale, VenueId.HYPERLIQUID)
    assert not quote.market_eligible
    assert quote.reason == "Public quote is stale."


def test_tie_breaker_is_stable_by_priority():
    route = request([VenueId.HYPERLIQUID, VenueId.LIGHTER])
    observed_at = datetime.now(UTC)
    quotes = [
        build_quote(route, MARKET, snapshot(VenueId.LIGHTER, observed_at=observed_at), VenueId.LIGHTER),
        build_quote(route, MARKET, snapshot(VenueId.HYPERLIQUID, observed_at=observed_at), VenueId.HYPERLIQUID),
    ]
    assert ranked(quotes)[0].venue == VenueId.HYPERLIQUID


def test_slippage_cap_blocks_insufficient_route():
    route = request([VenueId.HYPERLIQUID])
    route.slippage_cap_bps = 0
    quote = build_quote(route, MARKET, snapshot(VenueId.HYPERLIQUID), VenueId.HYPERLIQUID)
    assert not quote.market_eligible
    assert "slippage cap" in (quote.reason or "")


def test_venue_metadata_normalization_handles_native_formats():
    assert canonical_market("BTC/USD [BTC-USDC]") == "BTC"
    assert canonical_market("PERP_ETH_USDC") == "ETH"
    assert leverage_from_margin_fraction(200) == 50


async def test_hyperliquid_market_listings_include_live_prices():
    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return [
                {"universe": [{"name": "ETH", "szDecimals": 4, "maxLeverage": 50}]},
                [{
                    "markPx": "3123.45",
                    "oraclePx": "3122.9",
                    "prevDayPx": "3000",
                    "funding": "0.0001",
                    "openInterest": "10",
                    "dayNtlVlm": "20000000",
                }],
            ]

    class Client:
        async def post(self, *_args, **_kwargs):
            return Response()

    class Settings:
        hyperliquid_api_url = "https://example.test/info"

    markets = await PublicRoutingAdapters(Client(), Settings()).hyperliquid_markets()

    assert markets[0].market_id == "ETH"
    assert markets[0].price_precision == 2
    assert markets[0].mark_price == 3123.45
    assert markets[0].oracle_price == 3122.9
    assert round(markets[0].day_change_pct, 3) == 4.115
    assert markets[0].open_interest_usd == 31234.5


async def test_orderly_market_listings_include_ticker_prices():
    class Response:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class Client:
        async def get(self, url, **_kwargs):
            if url.endswith("/v1/public/info"):
                return Response({
                    "data": {
                        "rows": [{
                            "symbol": "PERP_AAPL_USDC_mythos",
                            "display_symbol_name": "AAPL",
                            "quote_tick": 0.01,
                            "base_imr": 0.1,
                            "status": "ACTIVE",
                        }],
                    },
                })
            return Response({
                "data": {
                    "rows": [{
                        "symbol": "PERP_AAPL_USDC_mythos",
                        "status": "ACTIVE",
                        "mark_price": 324.5,
                        "index_price": 324.4,
                        "est_funding_rate": 0.00008,
                        "24h_amount": 1000,
                    }],
                },
            })

    class Settings:
        orderly_api_url = "https://example.test"

    markets = await PublicRoutingAdapters(Client(), Settings()).orderly_markets()

    assert markets[0].market_id == "AAPL_MYTHOS"
    assert markets[0].mark_price == 324.5
    assert markets[0].oracle_price == 324.4
    assert markets[0].funding_rate_hourly == 0.00001
