from datetime import datetime, timezone
from typing import Literal

from pydantic import Field, model_validator

from .contracts import CheckResult, ExecutionDecision, StrictModel, TradeProposal


class AutomationPolicy(StrictModel):
    version: int = Field(ge=1)
    markets: list[str] = Field(min_length=1)
    venues: list[str] = Field(min_length=1)
    max_order_usd: float = Field(gt=0)
    max_daily_volume_usd: float = Field(gt=0)
    max_leverage: float = Field(ge=1)
    max_exposure_usd: float = Field(gt=0)
    max_daily_loss_usd: float = Field(gt=0)
    max_drawdown_pct: float = Field(gt=0, le=100)
    max_slippage_bps: int = Field(ge=0, le=10_000)
    max_analysis_age_seconds: int = Field(ge=5)
    min_confidence: float = Field(ge=0, le=1)
    min_consensus: float = Field(ge=0, le=1)
    cooldown_seconds: int = Field(ge=0)
    max_concurrent_positions: int = Field(ge=1)
    require_stop_loss: bool = True
    require_take_profit: bool = True
    daily_credit_budget: int = Field(ge=0)

    @classmethod
    def from_convex(cls, value: dict):
        return cls(
            version=value["version"], markets=value["allowedMarkets"], venues=value["allowedVenues"],
            max_order_usd=value["maxOrderUsd"], max_daily_volume_usd=value["maxDailyVolumeUsd"],
            max_leverage=value["maxLeverage"], max_exposure_usd=value["maxExposureUsd"],
            max_daily_loss_usd=value["maxDailyLossUsd"], max_drawdown_pct=value["maxDailyDrawdownPct"],
            max_slippage_bps=value["maxSlippageBps"],
            max_analysis_age_seconds=max(1, value["maxAnalysisAgeMs"] // 1000),
            min_confidence=value["minConfidence"], min_consensus=value["minConsensus"],
            cooldown_seconds=value["cooldownSeconds"], max_concurrent_positions=value["maxConcurrentPositions"],
            require_stop_loss=value["requireStopLoss"], require_take_profit=value["requireTakeProfit"],
            daily_credit_budget=value["dailyCreditBudget"],
        )


class RiskContext(StrictModel):
    now: datetime
    analysis_created_at: datetime
    confidence: float = Field(ge=0, le=1)
    consensus: float = Field(ge=0, le=1)
    daily_volume_usd: float = Field(ge=0)
    current_exposure_usd: float = Field(ge=0)
    daily_loss_usd: float = Field(ge=0)
    drawdown_pct: float = Field(ge=0)
    concurrent_positions: int = Field(ge=0)
    seconds_since_last_trade: int | None = Field(default=None, ge=0)
    credits_spent_today: int = Field(ge=0)
    emergency_stop: bool = False
    provider_quorum: bool = False
    evidence_complete: bool = False
    venue_healthy: bool = False
    reconciliation_clear: bool = False


def evaluate_policy(
    policy: AutomationPolicy,
    proposal: TradeProposal,
    context: RiskContext,
    quote_reference: str,
    idempotency_key: str,
) -> ExecutionDecision:
    age = (context.now - context.analysis_created_at).total_seconds()
    checks = [
        CheckResult(name="emergency_stop", passed=not context.emergency_stop, detail="Emergency stop must be off"),
        CheckResult(name="market", passed=proposal.market in policy.markets, detail=proposal.market),
        CheckResult(name="venue", passed=bool(set(proposal.candidate_venues) & set(policy.venues)), detail=",".join(proposal.candidate_venues)),
        CheckResult(name="order_size", passed=proposal.size_usd <= policy.max_order_usd, detail=str(proposal.size_usd)),
        CheckResult(name="daily_volume", passed=context.daily_volume_usd + proposal.size_usd <= policy.max_daily_volume_usd, detail=str(context.daily_volume_usd)),
        CheckResult(name="leverage", passed=proposal.leverage <= policy.max_leverage, detail=str(proposal.leverage)),
        CheckResult(name="exposure", passed=context.current_exposure_usd + proposal.size_usd <= policy.max_exposure_usd, detail=str(context.current_exposure_usd)),
        CheckResult(name="loss", passed=context.daily_loss_usd <= policy.max_daily_loss_usd, detail=str(context.daily_loss_usd)),
        CheckResult(name="drawdown", passed=context.drawdown_pct <= policy.max_drawdown_pct, detail=str(context.drawdown_pct)),
        CheckResult(name="slippage", passed=proposal.max_slippage_bps <= policy.max_slippage_bps, detail=str(proposal.max_slippage_bps)),
        CheckResult(name="analysis_age", passed=0 <= age <= policy.max_analysis_age_seconds, detail=f"{age:.1f}s"),
        CheckResult(name="confidence", passed=context.confidence >= policy.min_confidence, detail=str(context.confidence)),
        CheckResult(name="consensus", passed=context.consensus >= policy.min_consensus, detail=str(context.consensus)),
        CheckResult(name="positions", passed=context.concurrent_positions < policy.max_concurrent_positions, detail=str(context.concurrent_positions)),
        CheckResult(name="cooldown", passed=context.seconds_since_last_trade is None or context.seconds_since_last_trade >= policy.cooldown_seconds, detail=str(context.seconds_since_last_trade)),
        CheckResult(name="stop_loss", passed=not policy.require_stop_loss or proposal.protective_exits.stop_loss is not None, detail="protective exit"),
        CheckResult(name="take_profit", passed=not policy.require_take_profit or proposal.protective_exits.take_profit is not None, detail="protective exit"),
        CheckResult(name="credits", passed=context.credits_spent_today < policy.daily_credit_budget, detail=str(context.credits_spent_today)),
        CheckResult(name="provider_quorum", passed=context.provider_quorum, detail="provider quorum"),
        CheckResult(name="critical_evidence", passed=context.evidence_complete, detail="fresh and complete"),
        CheckResult(name="venue_health", passed=context.venue_healthy, detail="venue circuit breaker"),
        CheckResult(name="reconciliation", passed=context.reconciliation_clear, detail="no unresolved drift"),
    ]
    return ExecutionDecision(
        policy_version=policy.version, checks=checks, quote_reference=quote_reference,
        idempotency_key=idempotency_key, result="pass" if all(item.passed for item in checks) else "fail",
    )
