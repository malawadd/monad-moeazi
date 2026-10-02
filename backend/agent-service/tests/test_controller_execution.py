from datetime import datetime, timedelta, timezone

import pytest

from moeazi_agent.contracts import ProtectiveExits, TradeProposal
from moeazi_agent.execution_workflow import proposal_agreement_strength
from moeazi_agent.policy import AutomationPolicy, RiskContext, evaluate_policy


def _short_proposal() -> TradeProposal:
    return TradeProposal(account_id="account-a", market="BTC-USD", side="short",
        candidate_venues=["hyperliquid"], size_usd=25, leverage=1,
        order_type="market", max_slippage_bps=25,
        protective_exits=ProtectiveExits(stop_loss=105, take_profit=95),
        evidence_ids=["evidence-a"], analysis_id="analysis-a",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=1))


def _policy(min_consensus: float) -> AutomationPolicy:
    return AutomationPolicy(version=1, markets=["BTC-USD"], venues=["hyperliquid"],
        max_order_usd=100, max_daily_volume_usd=100, max_leverage=2,
        max_exposure_usd=100, max_daily_loss_usd=100, max_drawdown_pct=10,
        max_slippage_bps=50, max_analysis_age_seconds=120,
        min_confidence=0.5, min_consensus=min_consensus,
        cooldown_seconds=0, max_concurrent_positions=2,
        daily_credit_budget=100)


def test_signed_bearish_score_keeps_direction_and_meets_strength_threshold():
    proposal = _short_proposal()
    row = {"consensus": -0.7, "agreementStrength": 0.7,
        "controllerRef": {"schemaVersion": 1}}
    strength = proposal_agreement_strength(row, proposal)
    assert row["consensus"] == -0.7
    assert strength == 0.7
    now = datetime.now(timezone.utc)
    risk = RiskContext(now=now, analysis_created_at=now - timedelta(seconds=5),
        confidence=0.8, consensus=strength, daily_volume_usd=0,
        current_exposure_usd=0, daily_loss_usd=0, drawdown_pct=0,
        concurrent_positions=0, credits_spent_today=0, provider_quorum=True,
        evidence_complete=True, venue_healthy=True, reconciliation_clear=True)
    assert evaluate_policy(_policy(0.6), proposal, risk, "quote-a", "idempotency-a").result == "pass"
    assert evaluate_policy(_policy(0.8), proposal, risk, "quote-a", "idempotency-b").result == "fail"


def test_v1_proposal_rejects_direction_or_strength_drift():
    proposal = _short_proposal()
    with pytest.raises(ValueError, match="direction"):
        proposal_agreement_strength({"consensus": 0.7,
            "agreementStrength": 0.7, "controllerRef": {}}, proposal)
    with pytest.raises(ValueError, match="agreement strength"):
        proposal_agreement_strength({"consensus": -0.4,
            "agreementStrength": 0.9, "controllerRef": {}}, proposal)
