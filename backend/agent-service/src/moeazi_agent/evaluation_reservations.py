from datetime import datetime, timezone

from redis.asyncio import Redis

from .evaluation_v2_contracts import SpendingLimits


RESERVE_PLAN = """
if redis.call('EXISTS', KEYS[1]) == 1 then return 2 end
local global_limit = tonumber(ARGV[1])
for i = 2, #KEYS, 2 do
  local amount = tonumber(ARGV[(i / 2) + 1])
  local global = tonumber(redis.call('GET', KEYS[i + 1]) or '0')
  if global + amount > global_limit then return -i end
end
redis.call('SET', KEYS[1], 'reserved', 'EX', tonumber(ARGV[#ARGV]))
for i = 2, #KEYS, 2 do
  local amount = tonumber(ARGV[(i / 2) + 1])
  redis.call('SET', KEYS[i], amount, 'EX', tonumber(ARGV[#ARGV]))
  redis.call('INCRBY', KEYS[i + 1], amount)
  redis.call('EXPIRE', KEYS[i + 1], tonumber(ARGV[#ARGV]))
end
return 1
"""


RELEASE_PLAN = """
if redis.call('GET', KEYS[1]) ~= 'reserved' then return 0 end
for i = 2, #KEYS, 2 do
  local amount = tonumber(redis.call('GET', KEYS[i]) or '0')
  local global = tonumber(redis.call('GET', KEYS[i + 1]) or '0')
  local settled = tonumber(ARGV[(i / 2)])
  redis.call('SET', KEYS[i + 1], math.max(0, global - amount) + settled)
  redis.call('DEL', KEYS[i])
end
redis.call('SET', KEYS[1], 'released', 'EX', tonumber(ARGV[#ARGV]))
return 1
"""


async def reserve_complete_plan(
    redis: Redis, experiment_id: str, daily: dict[str, int],
    required_per_observation: int, limits: SpendingLimits,
    global_daily_microusd: int, ttl_seconds: int,
) -> None:
    total = sum(daily.values())
    peak = max(daily.values(), default=0)
    if required_per_observation > limits.maximum_per_observation_microusd:
        raise RuntimeError("Per-observation limit cannot fund the guaranteed maximum")
    if peak > limits.maximum_peak_day_microusd:
        raise RuntimeError("Peak-day limit cannot fund the guaranteed maximum")
    if total > limits.maximum_total_microusd:
        raise RuntimeError("Total limit cannot fund the guaranteed maximum")
    keys = [f"evaluation:v2:plan:{experiment_id}"]
    amounts = []
    for day, amount in sorted(daily.items()):
        keys.extend([
            f"evaluation:v2:reserved:{experiment_id}:{day}",
            f"evaluation:v2:global-reserved:{day}",
        ])
        amounts.append(amount)
    result = await redis.eval(
        RESERVE_PLAN, len(keys), *keys, global_daily_microusd,
        *amounts, max(172_800, ttl_seconds),
    )
    if int(result) < 0:
        index = abs(int(result))
        day = sorted(daily)[max(0, index // 2 - 1)]
        raise RuntimeError(f"Global evaluation capacity is unavailable for {day}")


async def release_complete_plan(
    redis: Redis, experiment_id: str, days: list[str],
    settled_by_day: dict[str, int] | None = None, ttl_seconds: int = 172_800,
) -> None:
    keys = [f"evaluation:v2:plan:{experiment_id}"]
    for day in sorted(days):
        keys.extend([
            f"evaluation:v2:reserved:{experiment_id}:{day}",
            f"evaluation:v2:global-reserved:{day}",
        ])
    settled = settled_by_day or {}
    await redis.eval(
        RELEASE_PLAN, len(keys), *keys,
        *(settled.get(day, 0) for day in sorted(days)), ttl_seconds,
    )


async def plan_is_reserved(redis: Redis, experiment_id: str) -> bool:
    return await redis.get(f"evaluation:v2:plan:{experiment_id}") == b"reserved"


def reservation_ttl(collection_end_at: str | None) -> int:
    if not collection_end_at:
        return 172_800
    end = datetime.fromisoformat(collection_end_at)
    remaining = max(0, int((end - datetime.now(timezone.utc)).total_seconds()))
    return remaining + 172_800
