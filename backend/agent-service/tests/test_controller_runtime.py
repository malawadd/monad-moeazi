from types import SimpleNamespace

import pytest

from moeazi_agent import execution_workflow, job_dispatch, temporal_app
from moeazi_agent.config import Settings
from moeazi_agent.contracts import ProtectiveExits, TradeProposal, utc_now


@pytest.mark.asyncio
async def test_private_analysis_without_authoritative_controller_stops_before_redis(monkeypatch):
    commands = []

    class Convex:
        async def command(self, name, **kwargs):
            commands.append((name, kwargs))
            return None

    monkeypatch.setattr(temporal_app, "get_settings", lambda: SimpleNamespace())
    monkeypatch.setattr(temporal_app, "ConvexWorkerClient", lambda _settings: Convex())
    monkeypatch.setattr("redis.asyncio.Redis.from_url", lambda _url:
        (_ for _ in ()).throw(AssertionError("Redis/provider work began")))
    with pytest.raises(RuntimeError, match="controller is unavailable"):
        await temporal_app.analyze_market_activity({"scope": "private", "account_id": "account-a",
            "job_id": "job-a", "market": "BTC-USD"})
    assert commands == [("getAgentExecutionContext",
        {"strategyAccountId": "account-a", "jobId": "job-a"})]


@pytest.mark.asyncio
async def test_legacy_proposal_cannot_reach_execution_gateway(monkeypatch):
    proposal = TradeProposal(account_id="account-a", market="BTC-USD", side="short",
        candidate_venues=["hyperliquid"], size_usd=25, leverage=1,
        order_type="market", max_slippage_bps=25,
        protective_exits=ProtectiveExits(), evidence_ids=["evidence-a"],
        analysis_id="analysis-a", expires_at=utc_now())

    class Convex:
        async def command(self, name, **_kwargs):
            assert name == "getTradeProposalExecutionContext"
            return {"proposal": {"payload": proposal.model_dump(mode="json"),
                "status": "approved", "consensus": 0.7}}

    monkeypatch.setattr(execution_workflow, "get_settings", lambda: SimpleNamespace())
    monkeypatch.setattr(execution_workflow, "ConvexWorkerClient", lambda _settings: Convex())
    monkeypatch.setattr(execution_workflow, "gateway_call", lambda *_args, **_kwargs:
        (_ for _ in ()).throw(AssertionError("Gateway was called")))
    with pytest.raises(RuntimeError, match="provenance is unavailable"):
        await execution_workflow.execute_proposal_activity({"proposal_id": "proposal-a"})


@pytest.mark.asyncio
async def test_failed_credit_cleanup_still_fails_claimed_manual_job(monkeypatch):
    failures = []

    class Convex:
        async def claim_job(self, *_args):
            return {"claimed": True, "job": {"scope": "private", "strategyAccountId": "account-a",
                "trigger": "manual_private", "teamId": "team-a", "teamVersionId": "version-a",
                "deploymentId": "deployment-a"}}

        async def command(self, name, **_kwargs):
            if name == "getAgentExecutionContext":
                return None
            if name == "releaseAgentCredits":
                raise RuntimeError("credit service unavailable")
            raise AssertionError(name)

        async def fail(self, *args, **kwargs):
            failures.append((args, kwargs))

    convex = Convex()
    monkeypatch.setattr(job_dispatch, "ConvexWorkerClient", lambda _settings: convex)
    with pytest.raises(RuntimeError, match="credit service unavailable"):
        await job_dispatch.dispatch_analysis_job(SimpleNamespace(),
            Settings(provider_mode="deepseek_only"), "job-a")
    assert len(failures) == 1 and failures[0][1]["retryable"] is False
