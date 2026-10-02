import asyncio

from .config import get_settings
from .convex import ConvexWorkerClient


async def schedule_forever() -> None:
    settings = get_settings()
    if not settings.scheduled_analysis_enabled:
        await asyncio.Event().wait()
        return
    convex = ConvexWorkerClient(settings)
    while True:
        await convex.command("scheduleDueAnalysisJobs", limit=100)
        await asyncio.sleep(15)


if __name__ == "__main__":
    asyncio.run(schedule_forever())
