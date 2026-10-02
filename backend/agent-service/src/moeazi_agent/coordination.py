from contextlib import asynccontextmanager

from redis.asyncio import Redis


class Coordination:
    def __init__(self, redis_url: str):
        self.redis = Redis.from_url(redis_url, decode_responses=True)

    @asynccontextmanager
    async def analysis_lock(self, scope_key: str, ttl_seconds: int = 300):
        key = f"analysis:lock:{scope_key}"
        acquired = await self.redis.set(key, "1", nx=True, ex=ttl_seconds)
        if not acquired:
            raise RuntimeError(f"Analysis already running for {scope_key}")
        try:
            yield
        finally:
            await self.redis.delete(key)

    async def coalesce_trigger(self, scope_key: str, window_seconds: int = 30) -> bool:
        return bool(await self.redis.set(f"analysis:trigger:{scope_key}", "1", nx=True, ex=window_seconds))

    async def touch_public_demand(self, market: str) -> None:
        await self.redis.set(f"public:demand:{market.upper()}", "1", ex=90)

    async def public_demand_exists(self, market: str) -> bool:
        return bool(await self.redis.exists(f"public:demand:{market.upper()}"))
