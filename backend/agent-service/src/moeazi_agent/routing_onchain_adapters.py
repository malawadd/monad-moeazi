from datetime import UTC, datetime
from decimal import Decimal

import httpx

from .routing_adapters import canonical_market, number_or_none, synthetic_book
from .routing_contracts import MarketListing, PublicVenueSnapshot, VenueId


def scaled(value, decimals=30) -> float:
    return float(Decimal(str(value or 0)) / (Decimal(10) ** decimals))


class OnchainRoutingAdapters:
    def __init__(self, client: httpx.AsyncClient, settings):
        self.client = client
        self.settings = settings

    async def gmx(self, market_id: str):
        coin = canonical_market(market_id)
        response = await self.client.get(
            f"{self.settings.execution_sidecar_url}/internal/gmx/snapshots",
            params={"symbol": coin}, headers=self._headers,
        )
        response.raise_for_status()
        row = next(item for item in response.json()["snapshots"] if canonical_market(item["symbol"]) == coin)
        mid = scaled(row.get("markPrice")); liquidity = scaled(
            row.get("availableLiquidityLong") if row.get("availableLiquidityLong") else row.get("availableLiquidityShort")
        )
        bids, asks = synthetic_book(mid, self.settings.gmx_proxy_spread_bps, max(10_000, liquidity))
        return PublicVenueSnapshot(
            venue=VenueId.GMX, market_id=coin, mid_price=mid,
            bid_price=bids[0].price, ask_price=asks[0].price, bids=bids, asks=asks,
            max_leverage=max(1, scaled(row.get("maxLeverage"), 4)),
            min_notional_usd=max(1, scaled(row.get("minPositionSizeUsd"))),
            taker_fee_bps=self.settings.gmx_position_fee_bps,
            funding_rate_hourly=scaled(row.get("fundingRateLong"), 30),
            open_interest_usd=scaled(row.get("longInterestUsd")) + scaled(row.get("shortInterestUsd")),
            volume_24h_usd=0, observed_at=datetime.now(UTC), source="gmx:sdk_ticker_proxy",
        )

    async def gmx_markets(self):
        response = await self.client.get(
            f"{self.settings.execution_sidecar_url}/internal/gmx/snapshots", headers=self._headers,
        )
        response.raise_for_status()
        return [MarketListing(
            market_id=canonical_market(row["symbol"]), label=row["symbol"],
            base_symbol=canonical_market(row["symbol"]), max_leverage=max(1, scaled(row.get("maxLeverage"), 4)),
            price_precision=2,
            mark_price=number_or_none(scaled(row.get("markPrice"))),
            open_interest_usd=scaled(row.get("longInterestUsd")) + scaled(row.get("shortInterestUsd")),
            volume_24h_usd=0,
            funding_rate_hourly=scaled(row.get("fundingRateLong"), 30),
            venues=[VenueId.GMX],
        ) for row in response.json()["snapshots"]]

    async def ostium(self, market_id: str):
        sdk = self._ostium_sdk()
        pairs = await sdk.subgraph.get_pairs()
        coin = canonical_market(market_id)
        pair = next(item for item in pairs if canonical_market(f'{item["from"]}/{item["to"]}') == coin)
        price_result = await sdk.price.get_price(pair["from"], pair["to"])
        mid = float(price_result[0]); liquidity = max(25_000, float(pair.get("maxOI") or 0))
        bids, asks = synthetic_book(mid, self.settings.ostium_proxy_spread_bps, liquidity)
        leverage = float(pair.get("makerMaxLeverage") or pair.get("group", {}).get("maxLeverage") or 1)
        return PublicVenueSnapshot(
            venue=VenueId.OSTIUM, market_id=coin, mid_price=mid,
            bid_price=bids[0].price, ask_price=asks[0].price, bids=bids, asks=asks,
            max_leverage=leverage, min_notional_usd=5,
            taker_fee_bps=float(pair.get("takerFeeP") or 0) * 100,
            funding_rate_hourly=float(pair.get("curFundingLong") or 0),
            open_interest_usd=float(pair.get("longOI") or 0) + float(pair.get("shortOI") or 0),
            volume_24h_usd=0, observed_at=datetime.now(UTC), source="ostium:sdk_price_proxy",
        )

    async def ostium_markets(self):
        pairs = await self._ostium_sdk().subgraph.get_pairs()
        return [MarketListing(
            market_id=canonical_market(f'{row["from"]}/{row["to"]}'), label=f'{row["from"]}/{row["to"]}',
            base_symbol=row["from"], quote_symbol=row["to"],
            category="crypto" if row["to"] in {"USD", "USDC"} and row["from"] in {"BTC", "ETH", "SOL", "LINK"} else "rwa",
            max_leverage=float(row.get("makerMaxLeverage") or row.get("group", {}).get("maxLeverage") or 1),
            price_precision=5 if row["to"] not in {"USD", "USDC"} else 2, venues=[VenueId.OSTIUM],
        ) for row in pairs]

    def _ostium_sdk(self):
        from ostium_python_sdk import NetworkConfig, OstiumSDK
        if not self.settings.ostium_rpc_url:
            raise RuntimeError("OSTIUM_RPC_URL is not configured")
        return OstiumSDK(NetworkConfig.mainnet(), rpc_url=self.settings.ostium_rpc_url)

    @property
    def _headers(self):
        return {"Authorization": f"Bearer {self.settings.worker_shared_secret.get_secret_value()}"}
