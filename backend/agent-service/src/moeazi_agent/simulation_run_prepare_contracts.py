"""Hash-free operator inputs for an owned causal simulation run."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, StrictInt, field_validator

from .finance_contracts import StrictFinanceModel, _hash
from .lifecycle_contracts import TradeAction
from .lifecycle_run_contracts import (
    SimulationFeeRule, SimulationFundingRule, SimulationOutcomeRule,
)


class RuleDraft(StrictFinanceModel):
    schema_version: Literal[1]
    instrument_version_id: str = Field(min_length=1)
    action: TradeAction
    side: Literal["buy", "sell"]
    trigger: Literal["always", "ask_lte", "bid_gte"]
    threshold_price_quote_per_base: str | None
    desired_quantity_units: str
    horizon_seconds: int = Field(gt=0, le=86_400)
    rationale_summary: str = Field(min_length=1, max_length=500)


class ScenarioDraft(StrictFinanceModel):
    schema_version: Literal[1]
    seed: int = Field(ge=0, le=9_007_199_254_740_991)
    clock_mode: Literal["historical_replay", "forward_shadow"]
    simulation_cursor_at: datetime
    simulation_end_at: datetime
    evidence_cutoff_at: datetime
    latency_ms: int = Field(ge=0, le=3_600_000)
    cancel_latency_ms: int = Field(ge=0, le=3_600_000)
    max_book_age_ms: int = Field(ge=1, le=86_400_000)
    depth_participation_bps: int = Field(ge=1, le=10_000)
    fee_bps: int = Field(ge=0, le=10_000)
    funding_bps: int = Field(ge=-10_000, le=10_000)
    protection_outcome_model: Literal["confirm", "reject", "scenario_events"]
    queue_model: Literal["no_queue_estimate", "recorded_sequence"]
    fee_rules: tuple[SimulationFeeRule, ...]
    funding_rules: tuple[SimulationFundingRule, ...]
    outcome_rules: tuple[SimulationOutcomeRule, ...]
    max_execution_deviation_bps: StrictInt | None = Field(default=None, ge=0, le=2500)
    order_time_in_force_ms: StrictInt | None = Field(default=None, ge=1, le=3_600_000)
    max_fill_events_per_order: StrictInt | None = Field(default=None, ge=1, le=64)


class ProtectionDraft(StrictFinanceModel):
    schema_version: Literal[1]
    policy_version: Literal["bounded-historical-unprotected-v1"]
    maximum_unprotected_seconds: StrictInt = Field(ge=1, le=3600)
    allow_increases_before_deadline: bool
    deadline_action: Literal["stop_and_escalate"]


class RunPreparationRequest(StrictFinanceModel):
    experiment_spec_id: str = Field(min_length=1, max_length=160)
    run_id: str = Field(min_length=1, max_length=256)
    observation_hashes: tuple[str, ...] = Field(min_length=1, max_length=4096)
    rule: RuleDraft
    scenario: ScenarioDraft
    protection_policy: ProtectionDraft | None = None

    @field_validator("observation_hashes")
    @classmethod
    def hashes_valid(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        for item in value:
            _hash(item)
        if len(set(value)) != len(value):
            raise ValueError("Dataset repeats an observation")
        return value
