import pytest

from moeazi_agent.config import Settings
from moeazi_agent.costs import tier_estimate
from moeazi_agent.job_dispatch import dispatch_analysis_job


class FakeHandle:
    id = "analysis-job-1"


class FakeTemporal:
    def __init__(self):
        self.started = []

    async def start_workflow(self, workflow, payload, **options):
        self.started.append((workflow, payload, options))
        return FakeHandle()


class FakeConvex:
    def __init__(self, job):
        self.job = job
        self.commands = []
        self.failures = []

    async def claim_job(self, job_id, holder_id):
        self.holder = holder_id
        return {"claimed": True, "reason": "claimed", "job": self.job}

    async def command(self, command, **payload):
        self.commands.append((command, payload))
        return {}

    async def fail(self, job_id, holder_id, error, retryable=True):
        self.failures.append((job_id, holder_id, error, retryable))


class FakeRuntime:
    def __init__(self, redis, settings):
        self.controls = type("Controls", (), {"lite_mode": False})()

    async def get(self):
        return self.controls


def manual_job(trigger="manual_public"):
    estimate = tier_estimate("focus")
    return {
        "_id": "job-1", "marketId": "BTC-USD", "tier": "focus", "scope": "public",
        "trigger": trigger, "createdAt": 1, "payloadJson": (
            f'{{"pricingVersion":"{estimate["pricingVersion"]}",'
            f'"estimatedCostMicrousd":{estimate["estimatedCostMicrousd"]}}}'
        ),
    }


async def test_manual_job_dispatches_one_exact_temporal_workflow(monkeypatch):
    convex = FakeConvex(manual_job())
    temporal = FakeTemporal()
    monkeypatch.setattr("moeazi_agent.job_dispatch.ConvexWorkerClient", lambda settings: convex)
    monkeypatch.setattr("moeazi_agent.job_dispatch.RuntimeControlStore", FakeRuntime)

    result = await dispatch_analysis_job(
        temporal, Settings(provider_mode="deepseek_only"), "job-1",
    )

    assert result == {
        "accepted": True, "status": "dispatched", "workflowId": "analysis-job-1",
    }
    assert len(temporal.started) == 1
    assert temporal.started[0][1]["job"]["job_id"] == "job-1"


async def test_non_manual_job_is_rejected_before_workflow_start(monkeypatch):
    convex = FakeConvex(manual_job("viewer_demand"))
    temporal = FakeTemporal()
    monkeypatch.setattr("moeazi_agent.job_dispatch.ConvexWorkerClient", lambda settings: convex)
    monkeypatch.setattr("moeazi_agent.job_dispatch.RuntimeControlStore", FakeRuntime)

    with pytest.raises(RuntimeError, match="explicitly requested manual"):
        await dispatch_analysis_job(
            temporal, Settings(provider_mode="deepseek_only"), "job-1",
        )

    assert temporal.started == []
    assert convex.failures[0][3] is False
