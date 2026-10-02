import asyncio
import hashlib

import httpx

from .routing_adapters import PublicRoutingAdapters, canonical_market, copy_listing_market_data
from .routing_contracts import MarketListing, RoutePreview, RouteRequest, VenueId
from .routing_math import build_quote, ranked
from .routing_onchain_adapters import OnchainRoutingAdapters


class RoutingService:
    def __init__(self, redis, settings):
        self.redis = redis
        self.settings = settings

    async def markets(self):
        key = "routing:markets:v2"
        cached = await self.redis.get(key)
        if cached:
            return [MarketListing.model_validate_json(item) for item in cached.decode().split("\n") if item]
        async with httpx.AsyncClient(timeout=self.settings.routing_timeout_seconds) as client:
            public, onchain = PublicRoutingAdapters(client, self.settings), OnchainRoutingAdapters(client, self.settings)
            groups = await asyncio.gather(
                public.markets(), onchain.gmx_markets(), onchain.ostium_markets(), return_exceptions=True,
            )
        merged: dict[str, MarketListing] = {}
        for group in groups:
            if isinstance(group, Exception):
                continue
            for item in group:
                item.market_id = canonical_market(item.market_id)
                if item.market_id in merged:
                    current = merged[item.market_id]
                    current.venues = list(dict.fromkeys([*current.venues, *item.venues]))
                    current.max_leverage = max(current.max_leverage, item.max_leverage)
                    copy_listing_market_data(current, item)
                else:
                    merged[item.market_id] = item
        markets = sorted(merged.values(), key=lambda item: (item.category != "crypto", item.market_id))
        if markets:
            await self.redis.setex(key, self.settings.routing_market_cache_seconds, "\n".join(item.model_dump_json() for item in markets))
        return markets

    async def preview(self, request: RouteRequest):
        request.market_id = canonical_market(request.market_id)
        cache_key = self._preview_key(request)
        cached = await self.redis.get(cache_key)
        if cached:
            return RoutePreview.model_validate_json(cached)
        markets = await self.markets()
        market = next((item for item in markets if item.market_id == request.market_id), None)
        if not market:
            raise ValueError(f"No venue lists {request.market_id}")
        async with httpx.AsyncClient(timeout=self.settings.routing_timeout_seconds) as client:
            public, onchain = PublicRoutingAdapters(client, self.settings), OnchainRoutingAdapters(client, self.settings)
            results = await asyncio.gather(
                public.snapshots(request.market_id), onchain.gmx(request.market_id), onchain.ostium(request.market_id),
                return_exceptions=True,
            )
        snapshots = results[0] if isinstance(results[0], list) else []
        snapshots.extend(result for result in results[1:] if hasattr(result, "venue"))
        by_venue = {item.venue: item for item in snapshots}
        quotes = [build_quote(request, market, by_venue.get(venue), venue) for venue in VenueId]
        public_rank = ranked(quotes); executable_rank = ranked(quotes, executable_only=True)
        best_market = public_rank[0].venue if public_rank else None
        best_executable = executable_rank[0].venue if executable_rank else None
        selected, override_applied = best_executable, False
        warnings = []
        if best_market and best_market != best_executable:
            warnings.append(f"{by_label(best_market)} is cheaper but needs account setup.")
        if request.override_venue:
            override = next(item for item in quotes if item.venue == request.override_venue)
            if override.executable:
                selected, override_applied = override.venue, True
            else:
                warnings.append(f"{override.venue_label} override was ignored because it is not executable.")
        preview = RoutePreview.create(
            request=request, market=market, best_market_venue=best_market,
            best_executable_venue=best_executable, selected_venue=selected,
            override_applied=override_applied, quotes=quotes, warnings=warnings,
        )
        await self.redis.setex(cache_key, self.settings.routing_preview_cache_seconds, preview.model_dump_json())
        return preview

    @staticmethod
    def _preview_key(request):
        digest = hashlib.sha256(request.model_dump_json().encode()).hexdigest()[:24]
        return f"routing:preview:v1:{digest}"


def by_label(venue: VenueId):
    return {"hyperliquid": "Hyperliquid", "lighter": "Lighter", "orderly": "Orderly", "gmx": "GMX", "ostium": "Ostium"}[venue.value]
