from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from .contracts import StrictModel
from .evaluation_contracts import Horizon, StrategySpec
from .model_routing import ModelRouting
from .roles import ROLES


SafetyCase = Literal[
    "missing_evidence", "stale_evidence", "contradiction",
    "prompt_injection", "wrong_market", "confidence_inflation",
]


class EvaluationStageSelection(StrictModel):
    forecast: bool = False
    deterministic_strategy: bool = False
    model_strategy: bool = False
    semantic_grounding: bool = False
    semantic_sample_rate: float = Field(default=0, ge=0, le=1)

    @model_validator(mode="after")
    def semantic_settings(self):
        if not self.semantic_grounding and self.semantic_sample_rate:
            raise ValueError("Semantic sampling requires the grounding stage")
        return self


class EvaluationSchedule(StrictModel):
    duration_minutes: int | None = Field(default=None, ge=15, le=43_200)
    cadence_minutes: int | None = Field(default=None, ge=15, le=1_440)
    market_cadence_minutes: dict[str, int] = Field(default_factory=dict)

    @model_validator(mode="after")
    def cadence_bounds(self):
        for market, cadence in self.market_cadence_minutes.items():
            if not market or cadence < 15 or cadence > 1_440 or cadence % 15:
                raise ValueError("Market cadence must be 15-1440 minutes in 15m increments")
        if self.cadence_minutes is not None and self.cadence_minutes % 15:
            raise ValueError("Cadence must use 15-minute increments")
        return self

    def cadence_for(self, market: str) -> int:
        value = self.market_cadence_minutes.get(market, self.cadence_minutes)
        if value is None:
            raise ValueError(f"Cadence is required for {market}")
        return value


class EvaluationRoleSetting(StrictModel):
    id: str
    horizon: Literal["minutes", "hours", "days", "weeks"]
    instructions: str = Field(default="", max_length=1_000)


class EvaluationSubjectV2(StrictModel):
    subject_id: str = Field(min_length=2, max_length=80)
    label: str = Field(min_length=2, max_length=120)
    kind: Literal["champion", "challenger"]
    tier: Literal["focus", "pro", "max"] = "focus"
    configuration_version: int | None = Field(default=None, ge=1)
    team_version_id: str | None = Field(default=None, min_length=16, max_length=80)
    selected_roles: list[str] = Field(min_length=1, max_length=30)
    role_settings: list[EvaluationRoleSetting] = Field(default_factory=list, max_length=20)
    quorum_minimum: int = Field(ge=1, le=30)
    prompt_bundle_id: str = "agent-v2"
    routing: ModelRouting | None = None
    operator_subject: str | None = None
    account_id: str | None = None

    @model_validator(mode="after")
    def quorum_fits(self):
        if self.quorum_minimum > len(self.selected_roles):
            raise ValueError("Quorum cannot exceed selected roles")
        if len(set(self.selected_roles)) != len(self.selected_roles):
            raise ValueError("Selected roles must be unique")
        unknown = set(self.selected_roles) - {item.name for item in ROLES}
        if unknown:
            raise ValueError(f"Unknown evaluation roles: {', '.join(sorted(unknown))}")
        settings = [item.id for item in self.role_settings]
        if len(set(settings)) != len(settings) or not set(settings).issubset(set(self.selected_roles)):
            raise ValueError("Role settings must identify distinct selected specialists")
        return self


class EvaluationExperimentV2(StrictModel):
    schema_version: Literal[2] = 2
    preset_id: str | None = Field(default=None, min_length=2, max_length=80)
    preset_cost_cap_microusd: int | None = Field(default=None, gt=0)
    name: str = Field(min_length=3, max_length=160)
    mode: Literal["replay", "live_shadow", "replay_and_live_shadow"]
    markets: list[str] = Field(min_length=1, max_length=500)
    replay_case_ids: list[str] = Field(default_factory=list, max_length=500)
    subjects: list[EvaluationSubjectV2] = Field(min_length=1, max_length=6)
    horizons: list[Horizon] = Field(default_factory=list, max_length=4)
    stages: EvaluationStageSelection
    safety_cases: list[SafetyCase] = Field(default_factory=list)
    custom_safety_case_ids: list[str] = Field(default_factory=list, max_length=100)
    replay_repetitions: int = Field(default=1, ge=1, le=5)
    schedule: EvaluationSchedule
    strategy: StrategySpec = Field(default_factory=StrategySpec)
    confirmed_shadow_only: bool = False

    @model_validator(mode="before")
    @classmethod
    def normalize_live_repetitions(cls, value):
        if (
            isinstance(value, dict) and value.get("mode") == "live_shadow"
            and value.get("replay_repetitions") in {0, None}
        ):
            return {**value, "replay_repetitions": 1}
        return value

    @model_validator(mode="after")
    def complete_scope(self):
        if self.preset_cost_cap_microusd and not self.preset_id:
            raise ValueError("A preset cost cap requires a preset identifier")
        if len(set(self.markets)) != len(self.markets):
            raise ValueError("Markets must be unique")
        if sum(item.kind == "champion" for item in self.subjects) != 1:
            raise ValueError("Exactly one champion is required")
        if self.stages.forecast and not self.horizons:
            raise ValueError("Forecast horizons are required")
        if not self.stages.forecast and self.horizons:
            raise ValueError("Forecast horizons require the forecast stage")
        live = self.mode in {"live_shadow", "replay_and_live_shadow"}
        if live and self.schedule.duration_minutes is None:
            raise ValueError("Live-shadow duration is required")
        if live:
            for market in self.markets:
                cadence = self.schedule.cadence_for(market)
                if cadence > int(self.schedule.duration_minutes or 0):
                    raise ValueError("Duration must be at least one cadence interval")
        if self.mode in {"replay", "replay_and_live_shadow"} and not (
            self.replay_case_ids or self.safety_cases or self.custom_safety_case_ids
        ):
            raise ValueError("Replay mode requires frozen or safety cases")
        return self


class SpendingLimits(StrictModel):
    maximum_per_observation_microusd: int = Field(gt=0)
    maximum_peak_day_microusd: int = Field(gt=0)
    maximum_total_microusd: int = Field(gt=0)


class EvaluationCreateV2(StrictModel):
    spec: EvaluationExperimentV2
    preview_hash: str = Field(min_length=64, max_length=64)
    limits: SpendingLimits


class EvaluationPreviewV2(StrictModel):
    spec: EvaluationExperimentV2
    limits: SpendingLimits | None = None


class EvaluationAssetDraft(StrictModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=500)
    payload: dict


class FrozenPromptBundle(StrictModel):
    bundle_id: str
    name: str
    version: int
    status: Literal["draft", "frozen"]
    payload: dict
    sha256: str
    created_at: datetime
