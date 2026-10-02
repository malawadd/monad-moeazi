import asyncio

from moeazi_agent.dispatcher import result_with_heartbeats


class SlowHandle:
    async def result(self):
        await asyncio.sleep(0.035)
        return {"ok": True}


class RecordingConvex:
    def __init__(self):
        self.heartbeats = []

    async def heartbeat(self, job_id, holder):
        self.heartbeats.append((job_id, holder))


async def test_dispatcher_renews_lease_while_workflow_runs():
    convex = RecordingConvex()
    result = await result_with_heartbeats(
        SlowHandle(), convex, "job-1", "holder-1", interval_seconds=0.01,
    )

    assert result == {"ok": True}
    assert len(convex.heartbeats) >= 2
    assert set(convex.heartbeats) == {("job-1", "holder-1")}
