"""Actual analysis completion with all IO and safety owners replaced by inert fakes."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from moeazi_agent import analysis_completion
from moeazi_agent.contracts import MarketSynthesis
from moeazi_agent.controller_contracts import customer_version_manifest, version_content_hash


def ref():
    return {"schemaVersion": 1, "environment": "live", "strategyAccountId": "acct-a",
            "controllerKind": "customer_team", "controllerId": "deployment-a",
            "controllerVersionId": "version-a", "contentHash": version_content_hash(
                customer_version_manifest("acct-a", "team-a", "version-a", "{}"))}


def synthesis(score):
    now = datetime.now(timezone.utc)
    scenarios = [{"name": name, "probability": probability, "triggers": [],
                  "invalidations": [], "disclaimer": "fixture"}
                 for name, probability in (("down", 0.5), ("flat", 0.3), ("up", 0.2))]
    return {"analysis_id": "analysis-a", "market": "BTC-USD", "tier": "focus",
            "consensus": score, "confidence": 0.8, "disagreement": 0.1,
            "freshness_ms": 100, "scenarios": scenarios, "conflicts": [],
            "visualization": {"forces": [], "story": [], "scenarios": scenarios,
                              "agents": [], "galaxy": []},
            "created_at": now.isoformat(), "valid_until": (now + timedelta(minutes=5)).isoformat()}


def payload(mode, score=-0.72):
    return {"job": {"scope": "private", "strategy_account_id": "acct-a",
                    "job_id": "job-a", "holder_id": "holder-a", "tier": "focus",
                    "team_id": "team-a", "team_version_id": "version-a",
                    "deployment_id": "deployment-a", "controller_ref": ref(),
                    "controller_mode": mode},
            "result": {"controller_ref": ref(), "controller_mode": mode,
                       "synthesis": synthesis(score), "calls": [], "reports": [{}] * 4,
                       "analysis_safety": {"decision_hash": "safety-a"},
                       "analysis_lifecycle_decision_hash": "life-a",
                       "safety_observed_at": datetime.now(timezone.utc).isoformat()}}


def test_managed_lite_proposal_requires_both_distinct_specialists():
    market = MarketSynthesis.model_validate(synthesis(0.5))
    reports = [{"role": "market_research"}, {"role": "risk_challenger"}]
    assert analysis_completion._proposal_quorum_complete(
        {"reports": reports, "lite_mode": True}, market, managed=True)
    assert not analysis_completion._proposal_quorum_complete(
        {"reports": reports[:1], "lite_mode": True}, market, managed=True)
    assert not analysis_completion._proposal_quorum_complete(
        {"reports": [reports[0], reports[0]], "lite_mode": True}, market, managed=True)
    assert not analysis_completion._proposal_quorum_complete(
        {"reports": reports, "lite_mode": True}, market, managed=False)


class FakeConvex:
    def __init__(self, mode):
        self.mode = mode
        self.commands = []
        self.completions = []
        self.assessed_operations = []

    async def command(self, name, **values):
        self.commands.append((name, values))
        if name == "getAgentExecutionContext":
            return {"controllerRef": ref(), "profile": {"_id": "team-a", "authorityMode": self.mode},
                    "teamVersionId": "version-a", "deploymentId": "deployment-a",
                    "policy": {"version": 1, "policy": {}}}
        if name == "settleAgentCredits":
            return {"settled": True}
        if name == "recordTradeProposal":
            status = {"shadow": "simulated", "approval_required": "pending_approval",
                      "autopilot": "approved"}[self.mode]
            return {"proposalId": "proposal-a", "status": status}
        raise AssertionError(f"Unexpected command: {name}")

    async def complete(self, *args):
        self.completions.append(args)


class FakeRedis:
    @classmethod
    def from_url(cls, value):
        return cls()

    async def aclose(self):
        pass


def setup(monkeypatch, mode):
    convex = FakeConvex(mode)
    monkeypatch.setattr(analysis_completion, "get_settings",
                        lambda: SimpleNamespace(postgres_dsn="fixture", redis_url="fixture"))
    monkeypatch.setattr(analysis_completion, "ConvexWorkerClient", lambda settings: convex)
    monkeypatch.setattr(analysis_completion, "AnalysisRepository",
                        lambda dsn: SimpleNamespace(engine=None))
    monkeypatch.setattr(analysis_completion, "Redis", FakeRedis)

    async def govern(**values):
        return SimpleNamespace(decision_hash="lifecycle-a"), values["payload"]

    async def assess(*args, **kwargs):
        convex.assessed_operations.append(args[7])
        return SimpleNamespace(decision_hash="proposal-safety-a", permits=lambda at: True)

    async def noop(*args, **kwargs):
        return 0

    monkeypatch.setattr(analysis_completion, "govern_projection", govern)
    monkeypatch.setattr(analysis_completion, "SafetyEnvelopeDecision",
                        SimpleNamespace(model_validate=lambda value: value))
    monkeypatch.setattr(analysis_completion, "assess_proposal", assess)
    monkeypatch.setattr(analysis_completion, "_record_safety_trace", noop)
    monkeypatch.setattr(analysis_completion, "_record_proposal_trace", noop)
    monkeypatch.setattr(analysis_completion, "_record_shadow_fill", noop)
    monkeypatch.setattr(analysis_completion, "_record_metrics", noop)
    monkeypatch.setattr(analysis_completion, "proposal_from_synthesis",
                        lambda *args: SimpleNamespace(market="BTC-USD", side="short",
                            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
                            model_dump_json=lambda: '{"fixture":"proposal"}'))
    return convex


@pytest.mark.asyncio
@pytest.mark.parametrize("mode,expected", [("shadow", "simulated"),
    ("approval_required", "pending_approval"), ("autopilot", "approved")])
async def test_completion_preserves_mode_and_negative_direction(monkeypatch, mode, expected):
    convex = setup(monkeypatch, mode)
    result = await analysis_completion.complete_analysis_job_activity(payload(mode))
    assert result["status"] == expected
    assert len(convex.completions) == 1
    proposal = [values for name, values in convex.commands if name == "recordTradeProposal"]
    assert len(proposal) == 1
    assert proposal[0]["consensus"] == -0.72
    assert proposal[0]["agreementStrength"] == 0.72
    assert proposal[0]["controllerRef"] == ref()
    assert proposal[0]["controllerMode"] == mode
    assert proposal[0]["teamVersionId"] == "version-a"
    assert proposal[0]["deploymentId"] == "deployment-a"
    expected_count = 2 if mode == "approval_required" else 1
    assert len(convex.assessed_operations) == expected_count


@pytest.mark.asyncio
async def test_changed_mode_blocks_before_snapshot_and_credit_settlement(monkeypatch):
    convex = setup(monkeypatch, "autopilot")
    with pytest.raises(ValueError, match="mode changed"):
        await analysis_completion.complete_analysis_job_activity(payload("approval_required"))
    assert not convex.completions
    assert all(name != "settleAgentCredits" for name, _ in convex.commands)


@pytest.mark.asyncio
async def test_changed_controller_provenance_blocks_before_snapshot(monkeypatch):
    convex = setup(monkeypatch, "shadow")
    bad = payload("shadow")
    bad["result"]["controller_ref"] = {**ref(), "controllerId": "other-deployment"}
    with pytest.raises(RuntimeError, match="provenance changed"):
        await analysis_completion.complete_analysis_job_activity(bad)
    assert not convex.completions


@pytest.mark.asyncio
async def test_complete_legacy_job_adapts_only_from_explicit_aliases_and_fresh_context(monkeypatch):
    convex = setup(monkeypatch, "shadow")
    old = payload("shadow")
    del old["job"]["controller_ref"]
    result = await analysis_completion.complete_analysis_job_activity(old)
    assert result["status"] == "simulated"
    assert len(convex.completions) == 1
    proposal = [values for name, values in convex.commands if name == "recordTradeProposal"][0]
    assert proposal["controllerRef"] == ref()


@pytest.mark.asyncio
async def test_legacy_job_without_original_mode_blocks_before_snapshot(monkeypatch):
    convex = setup(monkeypatch, "shadow")
    old = payload("shadow")
    del old["job"]["controller_ref"]
    del old["job"]["controller_mode"]
    with pytest.raises((RuntimeError, ValueError)):
        await analysis_completion.complete_analysis_job_activity(old)
    assert not convex.completions
