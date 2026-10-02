import asyncio
import logging
from datetime import datetime, timezone

from redis.asyncio import Redis
from temporalio.client import Client

from .config import get_settings
from .data_adapters import configured_content_adapters, default_market_adapters
from .storage import AnalysisRepository
from .convex import ConvexWorkerClient
from .dependency_safety_boundaries import assess_ingest
from .evidence_lifecycle_service import persist_ingested_evidence, preflight_ingested_evidence


log = logging.getLogger("moeazi.ingestor")
MARKETS = ("BTC-USD", "ETH-USD", "SOL-USD")


async def ingest_forever() -> None:
    settings = get_settings()
    repository = AnalysisRepository(settings.postgres_dsn)
    redis = Redis.from_url(settings.redis_url)
    convex = ConvexWorkerClient(settings)
    temporal = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
    adapters = {**default_market_adapters(), **configured_content_adapters(settings)}
    while True:
        for market in MARKETS:
            results = await asyncio.gather(
                *(adapter.fetch(market) for adapter in adapters.values()), return_exceptions=True,
            )
            for name, result in zip(adapters, results):
                if isinstance(result, Exception):
                    log.warning("adapter_failed", extra={"adapter": name, "market": market, "error": str(result)})
                    observed_at = datetime.now(timezone.utc)
                    try:
                        await assess_ingest(
                            settings, redis, convex, name, market,
                            f"{name}:{market}:{int(observed_at.timestamp())}", observed_at, False,
                        )
                    except Exception as exc:
                        log.warning("safety_receipt_failed", extra={"adapter": name, "error": str(exc)})
                    continue
                for item in result:
                    item.metadata["market"] = market
                    try:
                        lifecycle_preflight = preflight_ingested_evidence(item, market)
                    except RuntimeError as exc:
                        log.warning("lifecycle_blocked", extra={"adapter": name,
                            "market": market, "reason": str(exc).splitlines()[0]})
                        continue
                    safety = await assess_ingest(
                        settings, redis, convex, name, market, lifecycle_preflight.decision_hash,
                        item.ref.observed_at, True,
                    )
                    if not safety.permits(item.ref.observed_at):
                        continue
                    try:
                        await persist_ingested_evidence(repository=repository, redis=redis,
                            temporal=temporal, task_queue=settings.temporal_task_queue,
                            item=item, market=market)
                    except RuntimeError as exc:
                        log.warning("lifecycle_blocked", extra={"adapter": name,
                            "market": market, "reason": str(exc).splitlines()[0]})
        await asyncio.sleep(15)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(ingest_forever())
