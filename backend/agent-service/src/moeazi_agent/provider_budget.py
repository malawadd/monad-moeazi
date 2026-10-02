from datetime import datetime, timezone

from redis.asyncio import Redis


RESERVE_SCRIPT = """
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local amount = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
if current + amount > limit then return -1 end
local next = redis.call('INCRBY', KEYS[1], amount)
redis.call('EXPIRE', KEYS[1], 172800)
return next
"""


def budget_key(account_id: str) -> str:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"byok:provider-spend:{day}:{account_id}"


async def reserve_provider_budget(redis: Redis, account_id: str, amount: int, limit: int) -> int:
    if amount <= 0:
        return 0
    if limit <= 0:
        raise RuntimeError("BYOK provider daily spend limit is required")
    result = int(await redis.eval(RESERVE_SCRIPT, 1, budget_key(account_id), amount, limit))
    if result < 0:
        raise RuntimeError("BYOK provider daily spend limit exhausted")
    return amount


async def settle_provider_budget(redis: Redis, account_id: str, reserved: int, actual: int) -> None:
    release = max(0, reserved - max(0, actual))
    if release:
        await redis.decrby(budget_key(account_id), release)
