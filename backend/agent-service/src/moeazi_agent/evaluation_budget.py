from datetime import datetime, timezone

from redis.asyncio import Redis

from .evaluation_contracts import BudgetSpec


RESERVE = """
local daily = tonumber(redis.call('GET', KEYS[1]) or '0')
local total = tonumber(redis.call('GET', KEYS[2]) or '0')
local global = tonumber(redis.call('GET', KEYS[3]) or '0')
local amount = tonumber(ARGV[1])
if amount > tonumber(ARGV[2]) then return -1 end
if daily + amount > tonumber(ARGV[3]) then return -2 end
if total + amount > tonumber(ARGV[4]) then return -3 end
if global + amount > tonumber(ARGV[5]) then return -4 end
redis.call('INCRBY', KEYS[1], amount); redis.call('EXPIRE', KEYS[1], 172800)
redis.call('INCRBY', KEYS[2], amount)
redis.call('INCRBY', KEYS[3], amount); redis.call('EXPIRE', KEYS[3], 172800)
return 1
"""


async def reserve_evaluation_budget(
    redis: Redis, experiment_id: str, amount: int, budget: BudgetSpec, global_daily: int,
) -> None:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    result = await redis.eval(
        RESERVE, 3,
        f"evaluation:budget:daily:{experiment_id}:{day}",
        f"evaluation:budget:total:{experiment_id}",
        f"evaluation:budget:global:{day}",
        amount, budget.maximum_per_run_microusd, budget.maximum_daily_microusd,
        budget.maximum_total_microusd, global_daily,
    )
    messages = {
        -1: "Per-run evaluation cost ceiling reached",
        -2: "Daily experiment cost ceiling reached",
        -3: "Total experiment cost ceiling reached",
        -4: "Global evaluation cost ceiling reached",
    }
    if result in messages:
        raise RuntimeError(messages[result])


async def settle_evaluation_budget(
    redis: Redis, experiment_id: str, reserved: int, actual: int,
) -> None:
    unused = max(0, reserved - max(0, actual))
    if not unused:
        return
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    script = """
    for i = 1, 3 do
      local current = tonumber(redis.call('GET', KEYS[i]) or '0')
      redis.call('SET', KEYS[i], math.max(0, current - tonumber(ARGV[1])))
    end
    redis.call('EXPIRE', KEYS[1], 172800)
    redis.call('EXPIRE', KEYS[3], 172800)
    return 1
    """
    await redis.eval(
        script, 3,
        f"evaluation:budget:daily:{experiment_id}:{day}",
        f"evaluation:budget:total:{experiment_id}",
        f"evaluation:budget:global:{day}",
        unused,
    )
