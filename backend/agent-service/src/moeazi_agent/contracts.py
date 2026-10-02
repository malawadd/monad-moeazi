from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EvidenceRef(StrictModel):
    id: str
    source: str
    uri: HttpUrl | str
    observed_at: datetime
    event_at: datetime | None = None
    quality_score: float = Field(ge=0, le=1)
    content_hash: str = Field(min_length=16)


class SignalReport(StrictModel):
    role: str
    provider: Literal["openai", "deepseek", "openrouter", "deterministic"]
    model: str
    horizon: Literal["minutes", "hours", "days", "weeks"]
    stance: Literal["strong_bearish", "bearish", "neutral", "bullish", "strong_bullish"]
    score: float = Field(ge=-1, le=1)
    confidence: float = Field(ge=0, le=1)
    evidence: list[EvidenceRef] = Field(max_length=30)
    risks: list[str] = Field(max_length=20)
    decision_summary: str = Field(default="", max_length=500)
    key_factors: list[str] = Field(default_factory=list, max_length=8)
    uncertainties: list[str] = Field(default_factory=list, max_length=8)
    expires_at: datetime


class Scenario(StrictModel):
    name: str
    probability: float = Field(ge=0, le=1)
    triggers: list[str]
    invalidations: list[str]
    disclaimer: str


class SynthesisDraft(StrictModel):
    consensus: float = Field(ge=-1, le=1)
    confidence: float = Field(ge=0, le=1)
    scenarios: list[Scenario] = Field(min_length=3, max_length=5)
    conflicts: list[str] = Field(max_length=20)
    decision_summary: str = Field(default="", max_length=700)
    key_factors: list[str] = Field(default_factory=list, max_length=10)
    uncertainties: list[str] = Field(default_factory=list, max_length=10)


class AgentRunView(StrictModel):
    role: str
    provider: str
    model: str
    status: Literal["completed", "failed", "skipped"]
    evidence_ids: list[str] = []
    latency_ms: int = Field(default=0, ge=0)
    input_tokens: int = Field(default=0, ge=0)
    cached_input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    estimated_cost_usd: float | None = Field(default=None, ge=0)
    provider_cost_microusd: int = Field(default=0, ge=0)
    platform_credits: int = Field(default=0, ge=0)
    credential_source: str = "platform"
    served_model: str | None = None
    upstream_provider: str | None = None
    model_family: str | None = None
    routing_strategy: str | None = None
    fallback_attempts: int = Field(default=0, ge=0)
    generation_id: str | None = None
    cost_source: str = "rate_estimate"
    decision_summary: str = ""
    error: str | None = None


class VisualizationPayload(StrictModel):
    forces: list[dict[str, Any]]
    story: list[dict[str, Any]]
    scenarios: list[Scenario]
    agents: list[AgentRunView]
    galaxy: list[dict[str, Any]]
    portfolio: dict[str, Any] | None = None
    risk_overlay: dict[str, Any] | None = None


class MarketSynthesis(StrictModel):
    analysis_id: str
    market: str
    tier: Literal["focus", "pro", "max"]
    consensus: float = Field(ge=-1, le=1)
    confidence: float = Field(ge=0, le=1)
    disagreement: float = Field(ge=0, le=1)
    freshness_ms: int = Field(ge=0)
    scenarios: list[Scenario]
    conflicts: list[str]
    visualization: VisualizationPayload
    created_at: datetime = Field(default_factory=utc_now)
    valid_until: datetime

    @model_validator(mode="after")
    def probabilities_sum_to_one(self):
        total = sum(item.probability for item in self.scenarios)
        if self.scenarios and abs(total - 1.0) > 0.02:
            raise ValueError("Scenario probabilities must sum to one")
        return self


class ProtectiveExits(StrictModel):
    stop_loss: float | None = Field(default=None, gt=0)
    take_profit: float | None = Field(default=None, gt=0)


class TradeProposal(StrictModel):
    account_id: str
    market: str
    side: Literal["long", "short"]
    candidate_venues: list[str] = Field(min_length=1)
    size_usd: float = Field(gt=0)
    leverage: float = Field(ge=1)
    order_type: Literal["market", "limit"]
    limit_price: float | None = Field(default=None, gt=0)
    max_slippage_bps: int = Field(ge=0, le=10_000)
    protective_exits: ProtectiveExits
    evidence_ids: list[str]
    analysis_id: str
    expires_at: datetime


class CheckResult(StrictModel):
    name: str
    passed: bool
    detail: str


class ExecutionDecision(StrictModel):
    policy_version: int = Field(ge=1)
    checks: list[CheckResult]
    quote_reference: str
    idempotency_key: str
    result: Literal["pass", "fail"]
    safety_decision_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class AuthorityMode(StrEnum):
    SHADOW = "shadow"
    INSIGHTS = "insights"
    APPROVAL_REQUIRED = "approval_required"
    AUTOPILOT = "autopilot"
