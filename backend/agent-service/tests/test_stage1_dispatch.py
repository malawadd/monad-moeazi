"""The real dispatch function with inert Convex, Redis and Temporal boundaries."""

from types import SimpleNamespace

import pytest

from moeazi_agent import job_dispatch
from moeazi_agent.controller_contracts import customer_version_manifest, version_content_hash


def reference():
    return {"schemaVersion": 1, "environment": "live", "strategyAccountId": "acct-a",
            "controllerKind": "customer_team", "controllerId": "deployment-a",
            "controllerVersionId": "version-a", "contentHash": version_content_hash(
                customer_version_manifest("acct-a", "team-a", "version-a", "{}"))}


def managed_runtime():
    version = {
        "programId": "program-a", "version": 2,
        "sourceStrategyAccountId": "source-account", "teamVersionId": "source-team-version",
        "modelConfigurationId": "source-model", "policyId": "source-policy",
        "strategyArtifactHash": "a" * 64, "adapterProfileHash": "b" * 64,
        "runtimeCompatibility": "agent-v1", "teamConfigJson": '{"tier":"focus"}',
        "modelConfigurationJson": '{"routesJson":"{}","pricingVersion":"price-v1"}',
        "policyJson": "{}",
    }
    for label, field in (("teamConfigHash", "teamConfigJson"),
                         ("modelConfigurationHash", "modelConfigurationJson"),
                         ("policyHash", "policyJson")):
        version[label] = version_content_hash({"content": version[field]})
    manifest = {"schemaVersion": 1, "controllerKind": "managed_program",
                **{key: value for key, value in version.items()
                   if key not in {"teamConfigJson", "modelConfigurationJson", "policyJson"}}}
    version["contentHash"] = version_content_hash(manifest)
    assignment = {"assignmentId": "assignment-a", "strategyAccountId": "acct-a",
                  "programVersionId": "program-version-a", "status": "active", "source": "explicit"}
    controller_ref = {"schemaVersion": 1, "environment": "live", "strategyAccountId": "acct-a",
                      "controllerKind": "managed_program", "controllerId": "assignment-a",
                      "controllerVersionId": "program-version-a", "contentHash": version["contentHash"]}
    version["programVersionId"] = "program-version-a"
    return controller_ref, {"profile": {"_id": "assignment-a", "authorityMode": "shadow"},
        "controllerRef": controller_ref,
        "managedProgram": {"assignment": assignment, "version": version,
                           "agentRelease": {"versionId": "release-b", "contentHash": "c" * 64},
                           "teamConfig": {"roles": [{"id": "liquidity", "enabled": True}]}},
        "modelConfiguration": {"version": 2, "pricingVersion": "price-v1",
            "estimatedProviderCostMicrousd": 10, "routes": {}, "connections": []}}


class FakeConvex:
    def __init__(self, job, mode):
        self.job = job
        self.mode = mode
        self.commands = []
        self.failures = []

    async def claim_job(self, job_id, holder):
        assert job_id == "job-a"
        return {"claimed": True, "job": self.job}

    async def command(self, name, **values):
        self.commands.append((name, values))
        if name == "getAgentExecutionContext":
            return {"controllerRef": reference(),
                    "profile": {"_id": "team-a", "authorityMode": self.mode}}
        if name == "getModelRunConfiguration":
            return {"version": 1, "pricingVersion": "price-v1",
                    "estimatedProviderCostMicrousd": 10, "routes": {}}
        if name == "reserveAgentCredits":
            return {"insufficient": False}
        if name == "releaseAgentCredits":
            return {"released": True}
        raise AssertionError(f"Unexpected command: {name}")

    async def fail(self, job_id, holder, reason, retryable):
        self.failures.append((job_id, reason, retryable))


class FakeRedis:
    @classmethod
    def from_url(cls, value):
        assert value == "redis://fixture"
        return cls()

    async def aclose(self):
        pass


class FakeRuntime:
    def __init__(self, redis, settings):
        pass

    async def get(self):
        return SimpleNamespace(lite_mode=False)


class FakeTemporal:
    def __init__(self):
        self.starts = []

    async def start_workflow(self, fn, payload, **options):
        self.starts.append((payload, options))
        return SimpleNamespace(id=options["id"])


def setup(monkeypatch, job, mode):
    convex = FakeConvex(job, mode)
    temporal = FakeTemporal()
    monkeypatch.setattr(job_dispatch, "ConvexWorkerClient", lambda settings: convex)
    monkeypatch.setattr(job_dispatch, "Redis", FakeRedis)
    monkeypatch.setattr(job_dispatch, "RuntimeControlStore", FakeRuntime)
    monkeypatch.setattr(job_dispatch.ModelRouting, "model_validate", lambda value: None)
    monkeypatch.setattr(job_dispatch, "route_estimate", lambda *args: {"credits": 1})
    monkeypatch.setattr(job_dispatch, "assignments_for_tier", lambda tier: [])
    monkeypatch.setattr(job_dispatch, "assignments_for_configuration", lambda tier, roles: [])
    settings = SimpleNamespace(redis_url="redis://fixture", temporal_task_queue="fixture",
                               provider_mode="deepseek_only")
    return convex, temporal, settings


def job(mode, *, with_ref=True):
    value = {"_id": "job-a", "scope": "private", "trigger": "manual_private",
             "strategyAccountId": "acct-a", "userId": "user-a", "marketId": "BTC-USD",
             "tier": "focus", "teamId": "team-a", "teamVersionId": "version-a",
             "deploymentId": "deployment-a", "controllerMode": mode,
             "createdAt": 1_000, "payloadJson":
                 '{"pricingVersion":"price-v1","estimatedCostMicrousd":10}'}
    if with_ref:
        value["controllerRef"] = reference()
    return value


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["shadow", "approval_required", "autopilot"])
async def test_dispatch_preserves_mode_and_controller_in_temporal_payload(monkeypatch, mode):
    convex, temporal, settings = setup(monkeypatch, job(mode), mode)
    result = await job_dispatch.dispatch_analysis_job(temporal, settings, "job-a")
    assert result["status"] == "dispatched"
    assert len(temporal.starts) == 1
    payload, options = temporal.starts[0]
    assert options["id"] == "analysis-job-a"
    assert payload["analysis"]["controller_mode"] == mode
    assert payload["job"]["controller_mode"] == mode
    assert payload["analysis"]["controller_ref"] == reference()
    assert payload["job"]["controller_ref"] == reference()
    assert payload["analysis"]["team_id"] == "team-a"
    assert payload["analysis"]["deployment_id"] == "deployment-a"
    assert not convex.failures


@pytest.mark.asyncio
async def test_changed_mode_blocks_before_credit_reservation_or_workflow(monkeypatch):
    convex, temporal, settings = setup(monkeypatch, job("approval_required"), "autopilot")
    with pytest.raises(ValueError, match="mode changed"):
        await job_dispatch.dispatch_analysis_job(temporal, settings, "job-a")
    assert not temporal.starts
    assert all(name != "reserveAgentCredits" for name, _ in convex.commands)
    assert convex.failures


@pytest.mark.asyncio
async def test_complete_explicit_legacy_aliases_can_adapt_without_guessing(monkeypatch):
    convex, temporal, settings = setup(monkeypatch, job("shadow", with_ref=False), "shadow")
    result = await job_dispatch.dispatch_analysis_job(temporal, settings, "job-a")
    assert result["status"] == "dispatched"
    assert temporal.starts[0][0]["analysis"]["controller_ref"] == reference()
    assert not convex.failures


@pytest.mark.asyncio
async def test_incomplete_legacy_binding_blocks_before_reservation(monkeypatch):
    incomplete = job("shadow", with_ref=False)
    del incomplete["teamVersionId"]
    convex, temporal, settings = setup(monkeypatch, incomplete, "shadow")
    with pytest.raises(ValueError, match="incomplete"):
        await job_dispatch.dispatch_analysis_job(temporal, settings, "job-a")
    assert not temporal.starts
    assert all(name != "reserveAgentCredits" for name, _ in convex.commands)


@pytest.mark.asyncio
async def test_managed_program_dispatch_keeps_assignment_version_policy_mode_and_roles(monkeypatch):
    controller_ref, context = managed_runtime()
    managed_job = {"_id": "job-a", "scope": "private", "trigger": "manual_private",
        "strategyAccountId": "acct-a", "userId": "user-a", "marketId": "BTC-USD",
        "tier": "focus", "programAssignmentId": "assignment-a",
        "programVersionId": "program-version-a", "controllerRef": controller_ref,
        "agentReleaseVersionId": "release-b",
        "controllerMode": "shadow", "createdAt": 1_000,
        "payloadJson": '{"pricingVersion":"price-v1","estimatedCostMicrousd":10}'}
    convex, temporal, settings = setup(monkeypatch, managed_job, "shadow")
    original = convex.command

    async def command(name, **values):
        if name == "getAgentExecutionContext":
            return context
        return await original(name, **values)

    monkeypatch.setattr(convex, "command", command)
    result = await job_dispatch.dispatch_analysis_job(temporal, settings, "job-a")
    assert result["status"] == "dispatched"
    analysis, job_payload = (temporal.starts[0][0]["analysis"], temporal.starts[0][0]["job"])
    assert analysis["controller_ref"] == controller_ref
    assert analysis["controller_mode"] == "shadow"
    assert analysis["program_assignment_id"] == "assignment-a"
    assert analysis["program_version_id"] == "program-version-a"
    assert analysis["agent_release_version_id"] == "release-b"
    assert analysis["role_configuration"] == context["managedProgram"]["teamConfig"]["roles"]
    assert job_payload["program_assignment_id"] == "assignment-a"
    assert job_payload["program_version_id"] == "program-version-a"
    assert job_payload["agent_release_version_id"] == "release-b"
    assert not convex.failures


@pytest.mark.asyncio
async def test_managed_dispatch_rejects_release_mismatch_before_reservation(monkeypatch):
    controller_ref, context = managed_runtime()
    managed_job = {"_id": "job-a", "scope": "private", "trigger": "manual_private",
        "strategyAccountId": "acct-a", "userId": "user-a", "marketId": "BTC-USD",
        "tier": "focus", "programAssignmentId": "assignment-a",
        "programVersionId": "program-version-a", "agentReleaseVersionId": "release-old",
        "controllerRef": controller_ref, "controllerMode": "shadow", "createdAt": 1_000,
        "payloadJson": '{"pricingVersion":"price-v1","estimatedCostMicrousd":10}'}
    convex, temporal, settings = setup(monkeypatch, managed_job, "shadow")
    original = convex.command

    async def command(name, **values):
        return context if name == "getAgentExecutionContext" else await original(name, **values)

    monkeypatch.setattr(convex, "command", command)
    with pytest.raises(RuntimeError, match="release changed"):
        await job_dispatch.dispatch_analysis_job(temporal, settings, "job-a")
    assert not temporal.starts
    assert all(name != "reserveAgentCredits" for name, _ in convex.commands)
