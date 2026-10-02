from datetime import timedelta
from types import SimpleNamespace

import pytest

from moeazi_agent.config import Settings
from moeazi_agent.runtime_controls import RuntimeControls
from moeazi_agent.schedule_manager import (
    managed_schedule_id, sync_managed_program_schedules,
)
from moeazi_agent import scheduled_analysis


class FakeHandle:
    def __init__(self, client, schedule_id):
        self.client = client
        self.schedule_id = schedule_id

    async def update(self, update_fn):
        if self.schedule_id not in self.client.schedules:
            raise RuntimeError("schedule_not_found")
        self.client.schedules[self.schedule_id] = update_fn(
            self.client.schedules[self.schedule_id]).schedule

    async def delete(self):
        self.client.schedules.pop(self.schedule_id, None)


class FakeClient:
    def __init__(self):
        self.schedules = {}

    def get_schedule_handle(self, schedule_id):
        return FakeHandle(self, schedule_id)

    async def create_schedule(self, schedule_id, schedule):
        self.schedules[schedule_id] = schedule

    async def list_schedules(self):
        async def entries():
            for schedule_id in list(self.schedules):
                yield SimpleNamespace(id=schedule_id)
        return entries()


def controls(*, manual_guard=False, lite_mode=False):
    return RuntimeControls(manual_guard=manual_guard, lite_mode=lite_mode,
        version=1, updated_at="2026-10-01T00:00:00Z", updated_by="test")


def binding(*, active=True, version="version-a", revision=7, market="BTC-USD",
            mode="shadow"):
    return {"active": active, "assignmentId": "assignment-a",
        "programVersionId": version, "scheduleRevision": revision,
        "strategyAccountId": "account-a", "userId": "user-a",
        "controllerMode": mode, "cadence": "5m", "markets": [market],
        "controllerRef": {"schemaVersion": 1, "environment": "live",
            "strategyAccountId": "account-a", "controllerKind": "managed_program",
            "controllerId": "assignment-a", "controllerVersionId": version,
            "contentHash": "a" * 64}}


@pytest.mark.asyncio
async def test_managed_cadence_is_version_bound_lite_clamped_and_deleted_on_stop():
    client = FakeClient()
    settings = Settings()
    started = await sync_managed_program_schedules(
        client, binding(), controls(manual_guard=True, lite_mode=True), settings)
    schedule_id = managed_schedule_id("assignment-a", "BTC-USD")
    schedule = client.schedules[schedule_id]
    payload = schedule.action.args[0]
    assert started == {"synced": 1, "deleted": 0, "paused": True}
    assert schedule.state.paused is True
    assert schedule.spec.intervals[0].every == timedelta(minutes=15)
    assert payload["managed_program"] is True
    assert payload["program_assignment_id"] == "assignment-a"
    assert payload["program_version_id"] == "version-a"
    assert payload["schedule_revision"] == 7
    assert payload["cadence_minutes"] == 15
    assert payload["controller_mode"] == "shadow"
    assert payload["controllerRef"]["controllerKind"] == "managed_program"

    await sync_managed_program_schedules(client,
        binding(version="version-b", revision=8, mode="autopilot"), controls(), settings)
    assert client.schedules[schedule_id].action.args[0]["program_version_id"] == "version-b"
    assert client.schedules[schedule_id].action.args[0]["controller_mode"] == "autopilot"
    stopped = await sync_managed_program_schedules(
        client, binding(active=False, version="version-b", revision=9), controls(), settings)
    assert stopped["synced"] == 0
    assert schedule_id not in client.schedules


@pytest.mark.asyncio
async def test_managed_schedule_tick_skips_after_assignment_is_paused(monkeypatch):
    class FakeRedis:
        async def aclose(self):
            pass

    class FakeRuntime:
        async def get(self):
            return SimpleNamespace(manual_guard=False, lite_mode=False)

    class FakeConvex:
        def __init__(self):
            self.commands = []

        async def command(self, name, **payload):
            self.commands.append((name, payload))
            return None

    settings = SimpleNamespace(redis_url="redis://fixture", provider_mode="balanced")
    convex = FakeConvex()
    monkeypatch.setattr(scheduled_analysis, "get_settings", lambda: settings)
    monkeypatch.setattr("redis.asyncio.Redis.from_url", lambda _url: FakeRedis())
    monkeypatch.setattr(scheduled_analysis, "RuntimeControlStore", lambda *_args: FakeRuntime())
    monkeypatch.setattr(scheduled_analysis, "ConvexWorkerClient", lambda _settings: convex)
    result = await scheduled_analysis.prepare_scheduled_analysis_activity({
        "managed_program": True, "program_assignment_id": "assignment-a",
        "program_version_id": "version-a", "market": "BTC-USD",
        "schedule_revision": 7,
        "controllerRef": {"controllerKind": "managed_program"},
        "task_queue": "fixture", "safety_observed_at": "2026-10-01T00:00:00+00:00",
    })
    assert result is None
    assert [name for name, _ in convex.commands] == ["getAgentScheduleProfile"]
