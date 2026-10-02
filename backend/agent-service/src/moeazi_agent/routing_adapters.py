import asyncio
from datetime import UTC, datetime

import httpx

from .routing_contracts import MarketListing, PublicVenueSnapshot, VenueId, VenueLevel


def canonical_market(value: str) -> str:
    value = value.upper().strip().split("[")[0].strip()
    value = value.replace("-PERP", "").replace("PERP_", "").replace("_USDC", "")
    for suffix in ("/USDC", "/USD"):
        if value.endswith(suffix):
            return value.removesuffix(suffix)
    return value


def synthetic_book(mid: float, spread_bps: float, depth_usd: float) -> tuple[list[VenueLevel], list[VenueLevel]]:
    half = spread_bps / 20_000
    slices = (0.2, 0.3, 0.5)
    bids, asks = [], []
    for index, fraction in enumerate(slices, start=1):
        shift = half * index
        size = depth_usd * fraction / mid
        bids.append(VenueLevel(price=mid * (1 - shift), size=size))
        asks.append(VenueLevel(price=mid * (1 + shift), size=size))
    return bids, asks


def leverage_from_margin_fraction(value) -> float:
    fraction = float(value or 1)
    if fraction >= 1:
        fraction /= 10_000
    return max(1, 1 / fraction)


def price_decimals_from_size_decimals(value) -> int:
    return max(0, 6 - max(0, int(value or 0)))


def number_or_none(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def copy_listing_market_data(target: MarketListing, source: MarketListing) -> None:
    for field in (
        "mark_price",
        "oracle_price",
        "prev_day_price",
        "day_change_pct",
        "open_interest_usd",
        "volume_24h_usd",
        "funding_rate_hourly",
    ):
        if getattr(target, field) is None and getattr(source, field) is not None:
            setattr(target, field, getattr(source, field))


class PublicRoutingAdapters:
    def __init__(self, client: httpx.AsyncClient, settings):
        self.client = client
        self.settings = settings

    async def snapshots(self, market_id: str) -> list[PublicVenueSnapshot]:
        calls = [self.hyperliquid(market_id), self.lighter(market_id), self.orderly(market_id)]
        results = await asyncio.gather(*calls, return_exceptions=True)
        return [item for item in results if isinstance(item, PublicVenueSnapshot)]

    async def markets(self) -> list[MarketListing]:
        results = await asyncio.gather(self.hyperliquid_markets(), self.lighter_markets(), self.orderly_markets(), return_exceptions=True)
        merged: dict[str, MarketListing] = {}
        for group in results:
            if isinstance(group, Exception):
                continue
            for item in group:
                current = merged.get(item.market_id)
                if current:
                    current.venues = list(dict.fromkeys([*current.venues, *item.venues]))
                    current.max_leverage = max(current.max_leverage, item.max_leverage)
                    copy_listing_market_data(current, item)
                else:
                    merged[item.market_id] = item
        return sorted(merged.values(), key=lambda item: (item.category != "crypto", item.market_id))

    async def hyperliquid(self, market_id: str):
        coin = canonical_market(market_id)
        meta_response, book_response = await asyncio.gather(
            self.client.post(self.settings.hyperliquid_api_url, json={"type": "metaAndAssetCtxs"}),
            self.client.post(self.settings.hyperliquid_api_url, json={"type": "l2Book", "coin": coin}),
        )
        meta_response.raise_for_status(); book_response.raise_for_status()
        meta, contexts = meta_response.json()
        index = next(i for i, item in enumerate(meta["universe"]) if item["name"] == coin)
        asset, context = meta["universe"][index], contexts[index]
        levels = book_response.json()["levels"]
        bids = [VenueLevel(price=float(row["px"]), size=float(row["sz"])) for row in levels[0]]
        asks = [VenueLevel(price=float(row["px"]), size=float(row["sz"])) for row in levels[1]]
        mid = (bids[0].price + asks[0].price) / 2
        return PublicVenueSnapshot(
            venue=VenueId.HYPERLIQUID, market_id=coin, mid_price=mid,
            bid_price=bids[0].price, ask_price=asks[0].price, bids=bids, asks=asks,
            max_leverage=float(asset.get("maxLeverage", 1)), min_notional_usd=10,
            taker_fee_bps=self.settings.hyperliquid_taker_fee_bps,
            funding_rate_hourly=float(context.get("funding", 0)),
            open_interest_usd=float(context.get("openInterest", 0)) * mid,
            volume_24h_usd=float(context.get("dayNtlVlm", 0)), observed_at=datetime.now(UTC),
            source="hyperliquid:l2Book",
        )

    async def hyperliquid_markets(self):
        response = await self.client.post(self.settings.hyperliquid_api_url, json={"type": "metaAndAssetCtxs"})
        response.raise_for_status(); meta, contexts = response.json()
        listings = []
        for item, context in zip(meta["universe"], contexts):
            mark = number_or_none(context.get("markPx")) or number_or_none(context.get("midPx"))
            oracle = number_or_none(context.get("oraclePx"))
            prev = number_or_none(context.get("prevDayPx"))
            if item.get("isDelisted") or mark is None:
                continue
            listings.append(MarketListing(
                market_id=item["name"], label=f'{item["name"]} Perp', base_symbol=item["name"],
                max_leverage=float(item.get("maxLeverage", 1)),
                price_precision=price_decimals_from_size_decimals(item.get("szDecimals")),
                mark_price=mark, oracle_price=oracle, prev_day_price=prev,
                day_change_pct=((mark - prev) / prev) * 100 if prev else None,
                open_interest_usd=(number_or_none(context.get("openInterest")) or 0) * mark,
                volume_24h_usd=number_or_none(context.get("dayNtlVlm")),
                funding_rate_hourly=float(context.get("funding", 0)),
                venues=[VenueId.HYPERLIQUID],
            ))
        return listings

    async def lighter(self, market_id: str):
        coin = canonical_market(market_id)
        details = await self._lighter_details()
        item = next(row for row in details if row["symbol"].upper() == coin and row.get("status") == "active")
        response = await self.client.get(
            f"{self.settings.lighter_api_url}/api/v1/orderBookOrders",
            params={"market_id": item["market_id"], "limit": 50},
        )
        response.raise_for_status(); book = response.json()
        bids = self._lighter_levels(book.get("bids", [])); asks = self._lighter_levels(book.get("asks", []))
        mid = float(item.get("mark_price") or (bids[0].price + asks[0].price) / 2)
        return PublicVenueSnapshot(
            venue=VenueId.LIGHTER, market_id=coin, mid_price=mid,
            bid_price=bids[0].price, ask_price=asks[0].price, bids=bids, asks=asks,
            max_leverage=leverage_from_margin_fraction(item.get("min_initial_margin_fraction")),
            min_notional_usd=float(item.get("min_quote_amount") or 5),
            taker_fee_bps=float(item.get("taker_fee") or 0) * 10_000,
            funding_rate_hourly=float(item.get("current_funding_rate") or 0),
            open_interest_usd=float(item.get("open_interest") or 0) * mid,
            volume_24h_usd=float(item.get("daily_quote_token_volume") or 0),
            observed_at=datetime.now(UTC), source="lighter:orderBookOrders",
        )

    async def lighter_markets(self):
        return [MarketListing(
            market_id=row["symbol"].upper(), label=f'{row["symbol"].upper()} Perp',
            base_symbol=row["symbol"].upper(),
            max_leverage=leverage_from_margin_fraction(row.get("min_initial_margin_fraction")),
            price_precision=int(row.get("supported_price_decimals") or 2),
            mark_price=number_or_none(row.get("mark_price")),
            volume_24h_usd=number_or_none(row.get("daily_quote_token_volume")),
            funding_rate_hourly=float(row.get("current_funding_rate") or 0),
            venues=[VenueId.LIGHTER],
        ) for row in await self._lighter_details() if row.get("market_type") == "perp" and row.get("status") == "active"]

    async def _lighter_details(self):
        response = await self.client.get(f"{self.settings.lighter_api_url}/api/v1/orderBookDetails")
        response.raise_for_status(); return response.json()["order_book_details"]

    @staticmethod
    def _lighter_levels(rows):
        levels = [VenueLevel(price=float(row["price"]), size=float(row["remaining_base_amount"])) for row in rows]
        if not levels: raise ValueError("Lighter returned an empty book")
        return levels

    async def orderly(self, market_id: str):
        coin = canonical_market(market_id); symbol = f"PERP_{coin}_USDC"
        info, markets = await asyncio.gather(
            self.client.get(f"{self.settings.orderly_api_url}/v1/public/info"),
            self.client.get(f"{self.settings.orderly_api_url}/v1/public/futures_market", params={"symbol": symbol}),
        )
        info.raise_for_status(); markets.raise_for_status()
        definition = next(row for row in info.json()["data"]["rows"] if row["symbol"] == symbol)
        ticker = next(row for row in markets.json()["data"]["rows"] if row["symbol"] == symbol)
        mid = float(ticker["mark_price"]); volume = float(ticker.get("24h_volume") or 0)
        bids, asks = synthetic_book(mid, self.settings.orderly_proxy_spread_bps, max(25_000, volume * 0.001))
        return PublicVenueSnapshot(
            venue=VenueId.ORDERLY, market_id=coin, mid_price=mid,
            bid_price=bids[0].price, ask_price=asks[0].price, bids=bids, asks=asks,
            max_leverage=1 / float(definition.get("base_imr") or 1),
            min_notional_usd=float(definition.get("min_notional") or 10),
            taker_fee_bps=self.settings.orderly_taker_fee_bps,
            funding_rate_hourly=float(ticker.get("est_funding_rate") or 0) / 8,
            open_interest_usd=float(ticker.get("open_interest") or 0), volume_24h_usd=volume,
            observed_at=datetime.now(UTC), source="orderly:futures_market_proxy",
        )

    async def orderly_markets(self):
        info_response, ticker_response = await asyncio.gather(
            self.client.get(f"{self.settings.orderly_api_url}/v1/public/info"),
            self.client.get(f"{self.settings.orderly_api_url}/v1/public/futures_market"),
        )
        info_response.raise_for_status(); ticker_response.raise_for_status()
        tickers = {
            canonical_market(row["symbol"]): row
            for row in ticker_response.json()["data"]["rows"]
            if row.get("status") in {"ACTIVE", "TRADING"}
        }
        return [MarketListing(
            market_id=canonical_market(row["symbol"]), label=row.get("display_name") or row.get("display_symbol_name") or row["symbol"],
            base_symbol=canonical_market(row["symbol"]), max_leverage=1 / float(row.get("base_imr") or 1),
            price_precision=max(0, len(str(row.get("quote_tick", "0.01")).split(".")[-1].rstrip("0"))),
            mark_price=number_or_none(tickers.get(canonical_market(row["symbol"]), {}).get("mark_price")),
            oracle_price=number_or_none(tickers.get(canonical_market(row["symbol"]), {}).get("index_price")),
            volume_24h_usd=number_or_none(tickers.get(canonical_market(row["symbol"]), {}).get("24h_amount")),
            funding_rate_hourly=float(tickers.get(canonical_market(row["symbol"]), {}).get("est_funding_rate") or 0) / 8,
            venues=[VenueId.ORDERLY],
        ) for row in info_response.json()["data"]["rows"] if row.get("status") in {"ACTIVE", "TRADING"}]
