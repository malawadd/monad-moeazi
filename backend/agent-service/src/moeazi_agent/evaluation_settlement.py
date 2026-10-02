from datetime import datetime, timezone

from redis.asyncio import Redis
from temporalio import activity

from .config import get_settings
from .evaluation_outcomes import EvaluationOutcomeRepository
from .routing_service import RoutingService


@activity.defn
async def settle_evaluation_activity(experiment_id: str) -> dict:
    settings = get_settings()
    repository = EvaluationOutcomeRepository(settings.postgres_dsn)
    redis = Redis.from_url(settings.redis_url)
    settled_outcomes = settled_fills = 0
    prices: dict[str, float] = {}
    try:
        for row in await repository.due_outcomes():
            price = await _price(prices, redis, settings, row["market"])
            if price > 0:
                await repository.settle_outcome(row, price)
                settled_outcomes += 1
        now = datetime.now(timezone.utc)
        for row in await repository.open_fills():
            price = await _price(prices, redis, settings, row["market"])
            if price <= 0:
                continue
            reason = _close_reason(row, price, now)
            if reason:
                await repository.settle_fill(row, price, reason)
                settled_fills += 1
        return {
            "experimentId": experiment_id,
            "outcomes": settled_outcomes, "fills": settled_fills,
        }
    finally:
        await redis.aclose()


async def _price(prices: dict, redis, settings, market: str) -> float:
    if market in prices:
        return prices[market]
    listings = await RoutingService(redis, settings).markets()
    item = next((row for row in listings if row.market_id == market), None)
    prices[market] = float(item.mark_price or 0) if item else 0
    return prices[market]


def _close_reason(row: dict, price: float, now: datetime) -> str | None:
    if row["side"] == "long":
        reason = (
            "stop" if price <= row["stop_price"]
            else "target" if price >= row["take_price"] else None
        )
    else:
        reason = (
            "stop" if price >= row["stop_price"]
            else "target" if price <= row["take_price"] else None
        )
    if not reason and row["maximum_hold_at"] and row["maximum_hold_at"] <= now:
        return "expiry"
    return reason
