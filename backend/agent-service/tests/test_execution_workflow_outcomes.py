from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from moeazi_agent import execution_workflow
from moeazi_agent.contracts import ProtectiveExits, TradeProposal


CONTROLLER_REF = {
    "schemaVersion": 1,
    "environment": "live",
    "strategyAccountId": "account-a",
    "controllerKind": "customer_team",
    "controllerId": "deployment-a",
    "controllerVersionId": "version-a",
    "contentHash": "a" * 64,
}


def execution_context():
    now = datetime.now(timezone.utc)
    proposal = TradeProposal(
        account_id="account-a", market="BTC-USD", side="long",
        candidate_venues=["hyperliquid"], size_usd=25, leverage=1,
        order_type="market", max_slippage_bps=25,
        protective_exits=ProtectiveExits(stop_loss=90, take_profit=110),
        evidence_ids=["evidence-a"], analysis_id="analysis-a",
        expires_at=now + timedelta(minutes=5),
    )
    row = {
        "_id": "proposal-a", "payload": proposal.model_dump(mode="json"),
        "status": "approved", "controllerRef": CONTROLLER_REF,
        "controllerMode": "approval_required", "strategyAccountId": "account-a",
        "teamId": "team-a", "teamVersionId": "version-a", "deploymentId": "deployment-a",
        "createdAt": int(now.timestamp() * 1000),
        "expiresAt": int((now + timedelta(minutes=5)).timestamp() * 1000),
        "confidence": 0.9, "consensus": 0.7, "agreementStrength": 0.7,
        "idempotencyKey": "proposal:analysis-a",
    }
    return {
        "proposal": row, "controllerRef": CONTROLLER_REF,
        "profile": {"_id": "team-a", "authorityMode": "approval_required", "paused": False},
        "strategy": {"status": "active", "emergencyStop": False},
        "availableCredits": 5,
        "policy": {
            "version": 1,
            "policy": {
                "allowedMarkets": ["BTC-USD"], "allowedVenues": ["hyperliquid"],
                "maxOrderUsd": 100, "maxDailyVolumeUsd": 1000, "maxLeverage": 2,
                "maxExposureUsd": 1000, "maxDailyLossUsd": 100,
                "maxDailyDrawdownPct": 20, "maxSlippageBps": 100,
                "maxAnalysisAgeMs": 60_000, "minConfidence": 0.5,
                "minConsensus": 0.5, "cooldownSeconds": 0,
                "maxConcurrentPositions": 2, "requireStopLoss": True,
                "requireTakeProfit": True, "dailyCreditBudget": 10,
            },
        },
    }


async def run_activity(monkeypatch, dispatch_status, *, proposal_status="approved",
                       capture_error=False, settings=None, context_extra=None):
    context = execution_context()
    context["proposal"]["status"] = proposal_status
    if context_extra:
        context.update(context_extra)
    commands = []
    gateway_calls = []
    safety = {
        "outcome": "allow", "operation": "submit", "receipt_hashes": [],
        "mode": "approval_required", "reasons": [], "decision_hash": "b" * 64,
    }

    class Convex:
        async def command(self, name, **kwargs):
            commands.append((name, kwargs))
            if name == "getTradeProposalExecutionContext":
                return context
            return {"status": kwargs.get("status")}

    async def gateway(path, payload):
        gateway_calls.append((path, payload))
        if path == "/internal/preflight/admission":
            return {"preflightAdmissionDecision": {"outcome": "allow"}}
        if path == "/internal/preflight":
            return {
                "quote": {"raw": {"price": 100}, "reference": "quote-a"},
                "decision": {"result": "pass", "checks": []},
                "preflightSafetyDecision": safety, "safetyDecision": safety,
            }
        if path == "/internal/dispatch":
            return {"status": dispatch_status, "idempotencyKey": payload["idempotency_key"]}
        if path == "/internal/reconcile/preflight":
            return {"safetyDecision": safety}
        if path == "/internal/reconcile":
            return {"venue": "hyperliquid", "account": "account-a",
                "snapshot": {"status": "partial", "certified": False,
                    "readConsistency": "non_atomic",
                    "coverage": "default_perp_dex_and_first_spot_dex"}}
        raise AssertionError(path)

    async def no_trace(*_args, **_kwargs):
        return None

    monkeypatch.setattr(execution_workflow, "get_settings", lambda: settings or SimpleNamespace())
    monkeypatch.setattr(execution_workflow, "ConvexWorkerClient", lambda _settings: Convex())
    monkeypatch.setattr(execution_workflow, "gateway_call", gateway)
    monkeypatch.setattr(execution_workflow, "record_execution_trace", no_trace)
    try:
        result = await execution_workflow.execute_proposal_activity({"proposal_id": "proposal-a"})
    except RuntimeError as error:
        if not capture_error:
            raise
        result = error
    return result, commands, gateway_calls


@pytest.mark.asyncio
async def test_simulated_dispatch_records_simulated_proposal_and_keeps_idempotency(monkeypatch):
    result, commands, gateway_calls = await run_activity(monkeypatch, "simulated")

    transitions = [kwargs["status"] for name, kwargs in commands
                   if name == "transitionTradeProposal"]
    dispatch = next(payload for path, payload in gateway_calls if path == "/internal/dispatch")
    assert result["status"] == "simulated"
    assert transitions == ["executing", "simulated"]
    assert dispatch["idempotency_key"] == "proposal:analysis-a"
    assert not any(path == "/internal/reconcile" for path, _ in gateway_calls)


@pytest.mark.asyncio
@pytest.mark.parametrize("dispatch_status", ["submitted", "executed", "uncertain", "pending"])
async def test_native_dispatch_with_partial_reconciliation_stays_executing(monkeypatch, dispatch_status):
    result, commands, gateway_calls = await run_activity(monkeypatch, dispatch_status)

    transitions = [kwargs["status"] for name, kwargs in commands
                   if name == "transitionTradeProposal"]
    assert result["status"] == dispatch_status
    assert result["reconciliation"] == {
        "status": "unavailable",
        "reason": "Verified owned Hyperliquid trading address is unavailable",
    }
    assert transitions == ["executing"]
    assert all(status != "executed" for status in transitions)
    dispatch = next(payload for path, payload in gateway_calls if path == "/internal/dispatch")
    assert dispatch["idempotency_key"] == "proposal:analysis-a"
    assert not any(path in {"/internal/reconcile/preflight", "/internal/reconcile"}
                   for path, _ in gateway_calls)


@pytest.mark.asyncio
async def test_missing_verified_hyperliquid_address_blocks_native_dispatch(monkeypatch):
    address = "0x1234567890abcdef1234567890abcdef12345678"
    context_rows = [
        {"venue": "hyperliquid", "role": "hyperliquid_master_wallet",
         "status": "ready", "walletAddress": address, "accountId": "legacy-master"},
        {"venue": "hyperliquid", "role": "hyperliquid_agent_wallet",
         "status": "ready", "walletAddress": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
         "accountId": "agent"},
    ]
    result, commands, gateway_calls = await run_activity(
        monkeypatch, "submitted",
        settings=SimpleNamespace(live_execution_enabled=True,
                                 certified_venue_set=frozenset({"hyperliquid"})),
        context_extra={"venueAccounts": context_rows},
    )

    transitions = [kwargs["status"] for name, kwargs in commands
                   if name == "transitionTradeProposal"]
    assert result["status"] == "blocked"
    assert result["execution"]["status"] == "not_submitted"
    assert result["execution"]["reason"] == \
        "Verified owned Hyperliquid trading address is unavailable"
    assert result["reconciliation"]["status"] == "unavailable"
    assert transitions == ["executing", "blocked"]
    assert not any(path in {"/internal/dispatch", "/internal/reconcile/preflight",
                            "/internal/reconcile"} for path, _ in gateway_calls)


@pytest.mark.asyncio
async def test_verified_address_alone_does_not_dispatch_without_financial_order(monkeypatch):
    master = "0x" + "1" * 40
    target = "0x" + "2" * 40
    result, commands, gateway_calls = await run_activity(
        monkeypatch, "submitted",
        settings=SimpleNamespace(live_execution_enabled=True,
                                 certified_venue_set=frozenset({"hyperliquid"})),
        context_extra={
            "strategy": {"_id": "account-a", "status": "active", "emergencyStop": False},
            "hyperliquidTradingAddress": {
                "schemaVersion": 1, "source": "verified_hyperliquid_binding",
                "strategyAccountId": "account-a", "venueAccountId": "venue-a",
                "masterAddress": master, "targetAddress": target,
                "targetKind": "subaccount",
                "permissionExpiresAt": int(datetime.now(timezone.utc).timestamp() * 1000) + 60_000,
            },
        },
    )
    assert result["status"] == "blocked"
    assert result["execution"]["reason"] == "Native financial order package is unavailable"
    assert [kwargs["status"] for name, kwargs in commands
            if name == "transitionTradeProposal"] == ["executing", "blocked"]
    assert not any(path == "/internal/dispatch" for path, _ in gateway_calls)


@pytest.mark.asyncio
async def test_executing_proposal_is_rejected_before_gateway_dispatch(monkeypatch):
    result, commands, gateway_calls = await run_activity(
        monkeypatch, "simulated", proposal_status="executing", capture_error=True,
    )

    assert isinstance(result, RuntimeError)
    assert str(result) == "Proposal is not executable: executing"
    assert [name for name, _kwargs in commands] == ["getTradeProposalExecutionContext"]
    assert gateway_calls == []
