"""Publish one bounded financial outbox batch through the configured worker route."""
from __future__ import annotations

import argparse
import asyncio
import json

from .config import get_settings
from .convex import ConvexWorkerClient
from .finance_delivery import deliver_finance_outbox
from .finance_repository import FinanceRepository


async def publish_once(limit: int) -> dict:
    settings = get_settings()
    repository = FinanceRepository(settings.postgres_dsn)
    publisher = ConvexWorkerClient(settings)
    try:
        return await deliver_finance_outbox(repository, publisher, limit=limit)
    finally:
        await publisher.client.aclose()
        await repository.engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=20, choices=range(1, 101),
                        metavar="1..100")
    parser.add_argument("--publish", action="store_true",
                        help="Dispatch to the configured Convex service; may incur service usage.")
    args = parser.parse_args()
    if not args.publish:
        parser.print_help()
        return
    try:
        result = asyncio.run(publish_once(args.limit))
    except Exception:
        # Connection exceptions may contain DSNs or credential-bearing URLs.
        print(json.dumps({"status": "unavailable", "acknowledged": None}))
        raise SystemExit(1) from None
    print(json.dumps(result, sort_keys=True))
    if result["acknowledged"] != result["claimed"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
