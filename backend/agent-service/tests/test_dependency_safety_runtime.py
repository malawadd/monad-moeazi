from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from moeazi_agent import scheduled_analysis, temporal_app
from moeazi_agent.dependency_safety_contracts import (
    DependencyStatus, SafetyOperation, SafetyScope,
)
from moeazi_agent.dependency_safety_service import (
    DependencyObservation, DependencySafetyService,
)
from moeazi_agent.dependency_incident_workflow import DependencyIncidentWorkflow


NOW = datetime(2026, 8, 6, 12, 0, tzinfo=timezone.utc)


def test_incident_workflow_needs_two_separated_health_observations_and_reopens():
    state = DependencyIncidentWorkflow()
    failure = {"status": "open", "observedAt": 1_000, "receiptHash": "failure"}
    first = {"status": "healthy", "observedAt": 2_000, "receiptHash": "healthy-1"}
    early = {"status": "healthy", "observedAt": 6_999, "receiptHash": "healthy-early"}
    second = {"status": "healthy", "observedAt": 7_000, "receiptHash": "healthy-2"}
    state._apply(failure)
    state._apply(first)
    assert state.state == "recovering" and state.healthy_observations == 1
    state._apply(early)
    assert state.state == "recovering"
    state._apply(second)
    assert state.state == "resolved" and state.healthy_observations == 2
    state._apply({**failure, "observedAt": 8_000, "receiptHash": "failure-2"})
    assert state.state == "open" and state.healthy_observations == 0


class FakeDecision:
    def permits(self, _now):
        return False


class FakeRedis:
    async def aclose(self):
        return None


class FakeRuntime:
    async def get(self):
        return SimpleNamespace(manual_guard=False, lite_mode=True)


class FakeConvex:
    def __init__(self):
        self.commands = []

    async def command(self, name, **payload):
        self.commands.append(name)
        if name == "getAgentScheduleProfile":
            controller = {"schemaVersion": 1, "environment": "live",
                "strategyAccountId": "acct-a", "controllerKind": "customer_team",
                "controllerId": "deployment-a", "controllerVersionId": "version-a",
                "contentHash": "a" * 64}
            return {
                "profile": {"_id": "profile-a", "strategyAccountId": "acct-a",
                    "lifecycleStatus": "active"},
                "strategy": {"status": "active", "emergencyStop": False},
                "markets": ["ETH-USDC"], "availableCredits": 10,
                "deployments": [{"_id": "deployment-a", "teamVersionId": "version-a",
                    "marketId": "ETH-USDC", "status": "active", "mode": "shadow",
                    "controllerRef": controller}],
            }
        if name == "getModelRunConfiguration":
            return {"version": 1, "routes": {}}
        raise AssertionError(f"Authority-increasing command was called: {name}")


@pytest.mark.asyncio
async def test_blocked_analysis_makes_no_provider_call(monkeypatch):
    settings = SimpleNamespace(redis_url="redis://fixture", provider_mode="balanced",
        postgres_dsn="postgresql+asyncpg://fixture")
    monkeypatch.setattr(temporal_app, "get_settings", lambda: settings)
    monkeypatch.setattr("redis.asyncio.Redis.from_url", lambda _url: FakeRedis())
    monkeypatch.setattr(temporal_app, "RuntimeControlStore", lambda *_args: FakeRuntime())
    monkeypatch.setattr(temporal_app, "ConvexWorkerClient", lambda _settings: FakeConvex())
    monkeypatch.setattr(temporal_app, "AnalysisRepository",
        lambda *_args: SimpleNamespace(engine=None))
    class Lifecycle:
        async def save_decision_bundle(self, *_args): return None
    monkeypatch.setattr(temporal_app, "EvidenceLifecycleRepository", lambda *_args: Lifecycle())

    async def blocked(*_args, **_kwargs):
        return FakeDecision()

    monkeypatch.setattr(temporal_app, "assess_analysis", blocked)
    monkeypatch.setattr(
        temporal_app, "build_provider_bundle",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("provider dispatch occurred")),
    )
    with pytest.raises(RuntimeError, match="Dependency safety blocks analysis"):
        await temporal_app.analyze_market_activity({
            "market": "ETH-USDC", "tier": "focus", "scope": "public",
            "job_id": "job-a", "safety_observed_at": NOW.isoformat(),
        })


@pytest.mark.asyncio
async def test_scheduled_block_happens_before_enqueue_or_credit_reservation(monkeypatch):
    settings = SimpleNamespace(redis_url="redis://fixture", provider_mode="balanced",
        postgres_dsn="postgresql+asyncpg://fixture")
    convex = FakeConvex()
    monkeypatch.setattr(scheduled_analysis, "get_settings", lambda: settings)
    monkeypatch.setattr("redis.asyncio.Redis.from_url", lambda _url: FakeRedis())
    monkeypatch.setattr(scheduled_analysis, "RuntimeControlStore", lambda *_args: FakeRuntime())
    monkeypatch.setattr(scheduled_analysis, "ConvexWorkerClient", lambda _settings: convex)
    monkeypatch.setattr(scheduled_analysis, "AnalysisRepository",
        lambda *_args: SimpleNamespace(engine=None))
    class Lifecycle:
        async def save_decision_bundle(self, *_args): return None
    monkeypatch.setattr(scheduled_analysis, "EvidenceLifecycleRepository",
        lambda *_args: Lifecycle())

    async def blocked(*_args, **_kwargs):
        return FakeDecision()

    monkeypatch.setattr(scheduled_analysis, "assess_analysis", blocked)
    result = await scheduled_analysis.prepare_scheduled_analysis_activity({
        "profile_id": "profile-a", "market": "ETH-USDC",
        "schedule_revision": 1, "task_queue": "fixture",
        "safety_observed_at": NOW.isoformat(),
    })
    assert result is None
    assert convex.commands == ["getAgentScheduleProfile", "getModelRunConfiguration"]


class FakeRepository:
    def __init__(self, events, fail=False):
        self.events = events
        self.fail = fail

    async def save_bundle(self, receipts, decision, recovery_enabled=True):
        self.events.append(("timescale", decision.decision_hash))
        if self.fail:
            raise RuntimeError("timescale unavailable")

    async def load_current_receipts(self, _required, _scope):
        return []


class ProjectionClient:
    def __init__(self, events, fail=False, incidents=None):
        self.events = events
        self.fail = fail
        self.incidents = incidents or []

    async def command(self, name, **payload):
        if name in {"getDependencySafetyProjection", "getDependencySafetyScopeProjection"}:
            return {"decisions": [], "health": [], "incidents": self.incidents}
        self.events.append(("convex", payload["decision"]["decisionHash"]))
        if self.fail:
            raise RuntimeError("convex unavailable")
        return {"incidentSignals": []}


def observation():
    return DependencyObservation(
        status=DependencyStatus.HEALTHY, reason_code="fixture_healthy",
        source_revision="fixture-r1", adapter_version="fixture-v1",
    )


class CoordinationRedis:
    def __init__(self, healthy):
        self.healthy = healthy

    async def ping(self):
        if not self.healthy:
            raise RuntimeError("redis unavailable")
        return True

    async def publish(self, *_args):
        return 1

    async def set(self, *_args, **_kwargs):
        return True


@pytest.mark.asyncio
async def test_persistence_is_timescale_first_then_convex_and_retry_ids_are_stable():
    events = []
    settings = SimpleNamespace(dependency_safety_mode="enforce")
    service = DependencySafetyService(settings, FakeRepository(events))
    target = SafetyScope(kind="account", key="account:acct-a", strategy_account_id="acct-a")
    kwargs = dict(
        operation=SafetyOperation.RENDER_PREVIOUS, scope=target, subject_key="render:a",
        observations={"convex_product_state": observation()},
        bindings={"market": "BTC", "snapshot_hash": "a" * 64},
        idempotency_key="render:a", evaluated_at=NOW,
        convex=ProjectionClient(events), redis=None, request_hash="a" * 64,
    )
    first = await service.assess(**kwargs)
    second = await service.assess(**kwargs)
    assert first.decision_id == second.decision_id
    assert [event[0] for event in events] == ["timescale", "convex", "timescale", "convex"]


@pytest.mark.asyncio
async def test_either_durable_write_failure_blocks_the_assessment():
    target = SafetyScope(kind="account", key="account:acct-a", strategy_account_id="acct-a")
    base = dict(
        operation=SafetyOperation.RENDER_PREVIOUS, scope=target, subject_key="render:a",
        observations={"convex_product_state": observation()},
        bindings={"market": "BTC", "snapshot_hash": "a" * 64},
        idempotency_key="render:a", evaluated_at=NOW, redis=None, request_hash="a" * 64,
    )
    events = []
    with pytest.raises(RuntimeError, match="timescale"):
        await DependencySafetyService(
            SimpleNamespace(dependency_safety_mode="enforce"), FakeRepository(events, True),
        ).assess(**base, convex=ProjectionClient(events))
    assert [event[0] for event in events] == ["timescale"]
    events = []
    with pytest.raises(RuntimeError, match="convex"):
        await DependencySafetyService(
            SimpleNamespace(dependency_safety_mode="enforce"), FakeRepository(events),
        ).assess(**base, convex=ProjectionClient(events, True))
    assert [event[0] for event in events] == ["timescale", "convex"]


@pytest.mark.asyncio
async def test_open_incident_stays_latched_until_durable_projection_is_resolved():
    target = SafetyScope(kind="account", key="account:acct-a", strategy_account_id="acct-a")
    settings = SimpleNamespace(dependency_safety_mode="enforce")
    from moeazi_agent.dependency_safety_matrix import incident_key
    key = incident_key("convex_product_state", target)
    incident = {
        "incidentKey": key, "dependencyId": "convex_product_state", "state": "half_open",
        "recoveryStartedAt": int((NOW.timestamp() - 10) * 1_000),
    }
    base = dict(
        operation=SafetyOperation.RENDER_PREVIOUS, scope=target, subject_key="render:a",
        observations={"convex_product_state": observation()},
        bindings={"market": "BTC", "snapshot_hash": "a" * 64},
        idempotency_key="render:a", evaluated_at=NOW, request_hash="a" * 64,
    )
    blocked = await DependencySafetyService(settings, FakeRepository([])).assess(
        **base, convex=ProjectionClient([], incidents=[incident]),
        redis=CoordinationRedis(False),
    )
    assert blocked.outcome == "block"
    still_blocked = await DependencySafetyService(settings, FakeRepository([])).assess(
        **base, convex=ProjectionClient([], incidents=[incident]),
        redis=CoordinationRedis(True),
    )
    assert still_blocked.outcome == "block"

    resolved = {**incident, "state": "resolved"}
    allowed_after_restart = await DependencySafetyService(settings, FakeRepository([])).assess(
        **base, convex=ProjectionClient([], incidents=[resolved]),
        redis=CoordinationRedis(False),
    )
    assert allowed_after_restart.outcome == "allow"


@pytest.mark.asyncio
async def test_render_previous_one_aged_healthy_receipt_never_releases_after_redis_loss():
    target = SafetyScope(kind="account", key="account:acct-a", strategy_account_id="acct-a")
    from moeazi_agent.dependency_safety_matrix import incident_key
    key = incident_key("convex_product_state", target)
    incident = {"incidentKey": key, "dependencyId": "convex_product_state",
        "state": "recovering", "recoveryStartedAt": int((NOW.timestamp() - 3_600) * 1_000)}
    decision = await DependencySafetyService(
        SimpleNamespace(dependency_safety_mode="enforce"), FakeRepository([]),
    ).assess(
        operation=SafetyOperation.RENDER_PREVIOUS, scope=target, subject_key="render:restart",
        observations={"convex_product_state": observation()},
        bindings={"market": "BTC", "snapshot_hash": "b" * 64},
        idempotency_key="render:restart", evaluated_at=NOW, request_hash="b" * 64,
        convex=ProjectionClient([], incidents=[incident]), redis=CoordinationRedis(False),
    )
    assert decision.outcome == "block"
    assert any(reason.startswith("incident_open:convex_product_state") for reason in decision.reasons)
