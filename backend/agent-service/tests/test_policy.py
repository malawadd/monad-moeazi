from datetime import timedelta

from moeazi_agent.contracts import ProtectiveExits, TradeProposal, utc_now
from moeazi_agent.policy import AutomationPolicy, RiskContext, evaluate_policy


def fixtures():
    now = utc_now()
    policy = AutomationPolicy(
        version=3, markets=["BTC-USD"], venues=["hyperliquid"], max_order_usd=1000,
        max_daily_volume_usd=5000, max_leverage=3, max_exposure_usd=3000,
        max_daily_loss_usd=300, max_drawdown_pct=10, max_slippage_bps=50,
        max_analysis_age_seconds=120, min_confidence=0.7, min_consensus=0.6,
        cooldown_seconds=60, max_concurrent_positions=3, daily_credit_budget=500,
    )
    proposal = TradeProposal(
        account_id="a1", market="BTC-USD", side="long", candidate_venues=["hyperliquid"],
        size_usd=500, leverage=2, order_type="market", max_slippage_bps=25,
        protective_exits=ProtectiveExits(stop_loss=95, take_profit=110),
        evidence_ids=["e1"], analysis_id="analysis-1", expires_at=now + timedelta(seconds=30),
    )
    context = RiskContext(
        now=now, analysis_created_at=now - timedelta(seconds=20), confidence=0.8, consensus=0.7,
        daily_volume_usd=0, current_exposure_usd=0, daily_loss_usd=0, drawdown_pct=0,
        concurrent_positions=0, seconds_since_last_trade=120, credits_spent_today=10,
        provider_quorum=True, evidence_complete=True,
        venue_healthy=True, reconciliation_clear=True,
    )
    return policy, proposal, context


def test_deterministic_policy_passes_safe_proposal():
    policy, proposal, context = fixtures()
    decision = evaluate_policy(policy, proposal, context, "q1", "idem1")
    assert decision.result == "pass"
    assert all(item.passed for item in decision.checks)


def test_emergency_stop_wins_race():
    policy, proposal, context = fixtures()
    decision = evaluate_policy(policy, proposal, context.model_copy(update={"emergency_stop": True}), "q1", "idem1")
    assert decision.result == "fail"
    assert next(item for item in decision.checks if item.name == "emergency_stop").passed is False
