import json

import pytest

from moeazi_agent import monitoring_stream


class FakePubSub:
    def __init__(self, messages):
        self.messages = list(messages)
        self.subscribed = []
        self.closed = False

    async def subscribe(self, *channels):
        self.subscribed = list(channels)

    async def get_message(self, **_kwargs):
        return self.messages.pop(0) if self.messages else None

    async def unsubscribe(self, *_channels):
        return None

    async def aclose(self):
        self.closed = True


class FakeRedis:
    def __init__(self, messages):
        self.subscription = FakePubSub(messages)
        self.closed = False

    def pubsub(self):
        return self.subscription

    async def aclose(self):
        self.closed = True


class FakeLifecycle:
    def __init__(self, states, expected_decision_hash="a" * 64):
        self.states = states
        self.expected_decision_hash = expected_decision_hash
        self.calls = []

    async def stream_trace_body(self, artifact, event, created_at, decision_hash,
            scope, observed_at):
        self.calls.append((artifact, event, created_at, decision_hash, scope, observed_at))
        state = self.states.get(artifact, "allowed")
        if state != "allowed" or decision_hash != self.expected_decision_hash:
            raise RuntimeError(state)
        return json.dumps({"account_id": scope.removeprefix("account:"),
            "analysis_id": artifact, "event_id": event,
            "created_at": created_at.isoformat(), "marker": f"durable-{artifact}"})


def trace_message(account: str, artifact: str, marker: str, decision_hash="a" * 64):
    data = json.dumps({"schema_version": 1, "account_id": account, "analysis_id": artifact,
        "event_id": f"{artifact}:event", "created_at": "2026-08-06T10:00:00Z",
        "lifecycle_decision_hash": decision_hash})
    return {"channel": f"agent-trace:{account}", "data": data}


@pytest.mark.asyncio
@pytest.mark.parametrize("blocked_state", [
    "held", "deleted", "partial", "unverifiable", "quarantined",
    "missing", "expired", "disputed", "ungoverned",
])
async def test_trace_sse_withholds_every_non_disclosable_state(monkeypatch, blocked_state):
    lifecycle = FakeLifecycle({"blocked": blocked_state, "allowed": "allowed"})
    monkeypatch.setattr(monitoring_stream, "EvidenceLifecycleRepository",
        lambda _engine: lifecycle)
    redis = FakeRedis([
        trace_message("account-a", "blocked", "must-not-leak"),
        trace_message("account-a", "allowed", "visible"),
    ])
    events = monitoring_stream.monitoring_events(
        "account-a", "redis://unused", object(), redis_client=redis, pause_seconds=0)
    try:
        assert "event: ready" in await anext(events)
        visible = await anext(events)
        assert "event: trace" in visible and "durable-allowed" in visible
        assert "must-not-leak" not in visible
        assert [call[0] for call in lifecycle.calls] == ["blocked", "allowed"]
        assert all(call[4] == "account:account-a" for call in lifecycle.calls)
    finally:
        await events.aclose()
    assert redis.closed and redis.subscription.closed


@pytest.mark.asyncio
async def test_trace_sse_revalidates_after_stream_open_and_state_change(monkeypatch):
    lifecycle = FakeLifecycle({"same-artifact": "allowed", "fallback": "allowed"})
    monkeypatch.setattr(monitoring_stream, "EvidenceLifecycleRepository",
        lambda _engine: lifecycle)
    redis = FakeRedis([
        trace_message("account-a", "same-artifact", "before-hold"),
        trace_message("account-a", "same-artifact", "after-hold"),
        trace_message("account-a", "fallback", "still-visible"),
    ])
    events = monitoring_stream.monitoring_events(
        "account-a", "redis://unused", object(), redis_client=redis, pause_seconds=0)
    try:
        await anext(events)
        first = await anext(events)
        assert "durable-same-artifact" in first
        lifecycle.states["same-artifact"] = "held"
        second = await anext(events)
        assert "durable-fallback" in second and "after-hold" not in second
        assert [call[0] for call in lifecycle.calls] == [
            "same-artifact", "same-artifact", "fallback"]
    finally:
        await events.aclose()


@pytest.mark.asyncio
async def test_trace_sse_rejects_malformed_and_cross_account_messages(monkeypatch):
    lifecycle = FakeLifecycle({"allowed": "allowed"})
    monkeypatch.setattr(monitoring_stream, "EvidenceLifecycleRepository",
        lambda _engine: lifecycle)
    redis = FakeRedis([
        {"channel": "agent-trace:account-a", "data": "not-json"},
        trace_message("account-b", "other-account", "must-not-leak")
        | {"channel": "agent-trace:account-a"},
        trace_message("account-a", "allowed", "visible"),
    ])
    events = monitoring_stream.monitoring_events(
        "account-a", "redis://unused", object(), redis_client=redis, pause_seconds=0)
    try:
        await anext(events)
        visible = await anext(events)
        assert "durable-allowed" in visible and "must-not-leak" not in visible
        assert [call[0] for call in lifecycle.calls] == ["allowed"]
    finally:
        await events.aclose()


@pytest.mark.asyncio
async def test_trace_sse_rejects_forged_redis_body_and_yields_durable_body(monkeypatch):
    lifecycle = FakeLifecycle({"same": "allowed"})
    monkeypatch.setattr(monitoring_stream, "EvidenceLifecycleRepository",
        lambda _engine: lifecycle)
    forged = trace_message("account-a", "same", "forged")
    forged["data"] = json.dumps({**json.loads(forged["data"]),
        "body": {"marker": "forged-redis-body"}})
    redis = FakeRedis([forged, trace_message("account-a", "same", "valid")])
    events = monitoring_stream.monitoring_events(
        "account-a", "redis://unused", object(), redis_client=redis, pause_seconds=0)
    try:
        await anext(events)
        visible = await anext(events)
        assert "durable-same" in visible and "forged-redis-body" not in visible
        assert len(lifecycle.calls) == 1
    finally:
        await events.aclose()


@pytest.mark.asyncio
async def test_trace_sse_rejects_stale_decision_for_same_identity(monkeypatch):
    lifecycle = FakeLifecycle({"same": "allowed"}, expected_decision_hash="b" * 64)
    monkeypatch.setattr(monitoring_stream, "EvidenceLifecycleRepository",
        lambda _engine: lifecycle)
    redis = FakeRedis([
        trace_message("account-a", "same", "stale", "a" * 64),
        trace_message("account-a", "same", "current", "b" * 64),
    ])
    events = monitoring_stream.monitoring_events(
        "account-a", "redis://unused", object(), redis_client=redis, pause_seconds=0)
    try:
        await anext(events)
        visible = await anext(events)
        assert "durable-same" in visible
        assert [call[3] for call in lifecycle.calls] == ["a" * 64, "b" * 64]
    finally:
        await events.aclose()
