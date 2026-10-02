from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from .contracts import StrictModel
from .model_routing import ModelRouting


Horizon = Literal["5m", "1h", "4h", "24h"]
ExperimentMode = Literal["replay", "live_shadow", "replay_and_live_shadow"]
StrategyMode = Literal["deterministic", "model_directed"]


class ForecastPoint(StrictModel):
    horizon: Horizon
    probability_up: float = Field(ge=0, le=1)
    probability_flat: float = Field(ge=0, le=1)
    probability_down: float = Field(ge=0, le=1)
    expected_return_bps: float = Field(ge=-100_000, le=100_000)
    confidence: float = Field(ge=0, le=1)
    invalidations: list[str] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def probability_total(self):
        total = self.probability_up + self.probability_flat + self.probability_down
        if abs(total - 1) > 0.02:
            raise ValueError("Forecast probabilities must sum to one")
        return self


class EvidenceClaim(StrictModel):
    text: str = Field(min_length=2, max_length=500)
    evidence_ids: list[str] = Field(min_length=1, max_length=8)
    confidence: float = Field(ge=0, le=1)


class GroundingVerdict(StrictModel):
    supported_claims: int = Field(ge=0)
    unsupported_claims: list[str] = Field(default_factory=list, max_length=12)
    injection_followed: bool = False
    wrong_market: bool = False
    confidence_inflation: bool = False
    summary: str = Field(max_length=500)


class EvaluationSignal(StrictModel):
    action: Literal["abstain", "forecast"]
    forecasts: list[ForecastPoint] = Field(default_factory=list, max_length=4)
    claims: list[EvidenceClaim] = Field(default_factory=list, max_length=12)
    uncertainties: list[str] = Field(default_factory=list, max_length=8)
    decision_summary: str = Field(max_length=700)

    @model_validator(mode="after")
    def forecast_shape(self):
        horizons = {item.horizon for item in self.forecasts}
        required = {"5m", "1h", "4h", "24h"}
        if self.action == "forecast" and horizons != required:
            raise ValueError("Forecast action requires exactly 5m, 1h, 4h, and 24h")
        if self.action == "abstain" and self.forecasts:
            raise ValueError("Abstention cannot include forecasts")
        return self


class ModelTradeIntent(StrictModel):
    action: Literal["abstain", "long", "short"]
    horizon: Horizon
    confidence: float = Field(ge=0, le=1)
    risk_fraction: float = Field(default=0.005, gt=0, le=0.05)
    leverage: float = Field(default=1, ge=1, le=100)
    stop_loss_pct: float = Field(default=2, gt=0, le=100)
    take_profit_pct: float = Field(default=4, gt=0, le=1_000)
    max_hold_seconds: int = Field(default=86_400, ge=300, le=604_800)
    evidence_ids: list[str] = Field(default_factory=list, max_length=30)
    decision_summary: str = Field(max_length=700)


class StrategySpec(StrictModel):
    version: str = "baseline-v1"
    starting_equity_usd: float = Field(default=10_000, gt=0)
    entry_consensus: float = Field(default=0.12, ge=0, le=1)
    minimum_confidence: float = Field(default=0.35, ge=0, le=1)
    maximum_leverage: float = Field(default=2, ge=1, le=20)
    risk_fraction: float = Field(default=0.005, gt=0, le=0.05)
    stop_loss_pct: float = Field(default=2, gt=0, le=50)
    take_profit_pct: float = Field(default=4, gt=0, le=100)
    maximum_positions: int = Field(default=5, ge=1, le=100)
    maximum_hold_seconds: int = Field(default=86_400, ge=300, le=604_800)


class EvaluationSubject(StrictModel):
    subject_id: str = Field(min_length=2, max_length=80)
    label: str = Field(min_length=2, max_length=120)
    kind: Literal["champion", "challenger"]
    tier: Literal["focus", "pro", "max"] = "focus"
    configuration_version: int | None = Field(default=None, ge=1)
    account_id: str | None = None
    operator_subject: str | None = None
    prompt_bundle_version: str = "agent-v2"
    routing: ModelRouting | None = None


class BudgetSpec(StrictModel):
    maximum_per_run_microusd: int = Field(gt=0)
    maximum_daily_microusd: int = Field(gt=0)
    maximum_total_microusd: int = Field(gt=0)

    @model_validator(mode="after")
    def ordered(self):
        if self.maximum_per_run_microusd > self.maximum_daily_microusd:
            raise ValueError("Per-run budget cannot exceed daily budget")
        if self.maximum_daily_microusd > self.maximum_total_microusd:
            raise ValueError("Daily budget cannot exceed total budget")
        return self


class ExperimentSpec(StrictModel):
    name: str = Field(min_length=3, max_length=160)
    mode: ExperimentMode
    subjects: list[EvaluationSubject] = Field(min_length=1, max_length=6)
    markets: list[str] = Field(default_factory=lambda: ["ALL_SUPPORTED"], min_length=1)
    horizons: list[Horizon] = Field(default_factory=lambda: ["5m", "1h", "4h", "24h"])
    strategy_modes: list[StrategyMode] = Field(
        default_factory=lambda: ["deterministic", "model_directed"], min_length=1
    )
    strategy: StrategySpec = Field(default_factory=StrategySpec)
    budget: BudgetSpec
    replay_repetitions: int = Field(default=2, ge=1, le=5)
    semantic_sample_rate: float = Field(default=0.1, ge=0, le=1)
    confirmed_shadow_only: bool = False

    @model_validator(mode="after")
    def validate_experiment(self):
        ids = [item.subject_id for item in self.subjects]
        if len(ids) != len(set(ids)):
            raise ValueError("Evaluation subject IDs must be unique")
        if sum(item.kind == "champion" for item in self.subjects) != 1:
            raise ValueError("Exactly one champion is required")
        if not self.confirmed_shadow_only:
            raise ValueError("Shadow-only confirmation is required")
        return self


class MarketReadiness(StrictModel):
    market: str
    status: Literal[
        "replay_ready", "live_shadow_ready", "temporarily_unscorable", "unavailable"
    ]
    reason: str
    liquidity_tier: Literal["high", "standard"]
    cadence_minutes: int
    mark_price: float | None = None


class EvaluationScorecard(StrictModel):
    experiment_id: str
    subject_id: str
    run_count: int = 0
    schema_success_rate: float = 0
    citation_validity_rate: float = 0
    grounding_flags: int = 0
    brier_score: float | None = None
    calibration_error: float | None = None
    forecast_accuracy: float | None = None
    abstention_rate: float = 0
    repeatability_score: float | None = None
    stance_flip_rate: float = 0
    mean_latency_ms: float = 0
    input_tokens: int = 0
    output_tokens: int = 0
    provider_cost_microusd: int = 0
    net_simulated_return_pct: float = 0
    maximum_drawdown_pct: float = 0
    volatility_adjusted_return: float | None = None
    profit_factor: float | None = None
    win_rate: float | None = None
    turnover_usd: float = 0
    fees_usd: float = 0
    slippage_usd: float = 0
    funding_usd: float = 0
    simulated_fills: int = 0
    rejected_intents: int = 0
    updated_at: datetime
