"""Frozen experimental replay clock and deterministic simulation assumptions."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, StrictBool, StrictInt, field_validator, model_validator

from .controller_contracts import ControllerRef
from .finance_contracts import FinanceError, FinanceScope, StrictFinanceModel, _digest, _hash, _utc, native_int
from .lifecycle_contracts import CustomerMode
from .lifecycle_execution_envelope import CAUSAL_MODEL_VERSION
from .observation_contracts import MarketObservation


def _version(value: object) -> int:
    if type(value) is not int or value != 1:
        raise FinanceError("simulation schema version must be the integer 1")
    return value


def simulation_dataset_hash(observations: tuple[MarketObservation, ...]) -> str:
    """Bind the exact ordered normalized replay corpus, not a caller's assertion."""
    if not observations:
        raise FinanceError("simulation dataset is empty")
    identities = [(item.source_id, item.source_event_id) for item in observations]
    if len(set(identities)) != len(identities):
        raise FinanceError("simulation dataset repeats a source event")
    return _digest("moeazi-simulation-dataset-v1", {
        "observations": [item.model_dump(mode="json") for item in observations],
    })


class SimulationFeeRule(StrictFinanceModel):
    order_ordinal: int = Field(gt=0)
    fill_ordinal: int = Field(gt=0)
    asset_unit_id: str = Field(min_length=1)
    registry_hash: str
    units: str

    @field_validator("registry_hash")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        return _hash(value)

    @field_validator("units")
    @classmethod
    def units_valid(cls, value: str) -> str:
        native_int(value, nonnegative=True)
        return value


class SimulationFundingRule(StrictFinanceModel):
    order_ordinal: int = Field(gt=0)
    source_event_id: str = Field(min_length=1)
    instrument_version_id: str = Field(min_length=1)
    at_cursor: datetime
    asset_unit_id: str = Field(min_length=1)
    registry_hash: str
    signed_units: str

    @field_validator("at_cursor")
    @classmethod
    def time_valid(cls, value: datetime) -> datetime:
        return _utc(value)

    @field_validator("registry_hash")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        return _hash(value)

    @field_validator("signed_units")
    @classmethod
    def units_valid(cls, value: str) -> str:
        if native_int(value) == 0:
            raise FinanceError("funding payment cannot have zero native units")
        return value


class SimulationOutcomeRule(StrictFinanceModel):
    order_ordinal: int = Field(gt=0)
    source_event_id: str = Field(min_length=1)
    kind: Literal["ack_lost", "cancelled", "rejected", "protection_accepted",
                  "protection_rejected"]
    at_cursor: datetime

    @field_validator("at_cursor")
    @classmethod
    def time_valid(cls, value: datetime) -> datetime:
        return _utc(value)


class SimulationScenario(StrictFinanceModel):
    schema_version: Literal[1]
    model_version: str = Field(min_length=1)
    model_hash: str
    dataset_hash: str
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
    max_execution_deviation_bps: StrictInt | None = Field(
        default=None, ge=0, le=2500, exclude_if=lambda value: value is None)
    order_time_in_force_ms: StrictInt | None = Field(
        default=None, ge=1, le=3_600_000, exclude_if=lambda value: value is None)
    max_fill_events_per_order: StrictInt | None = Field(
        default=None, ge=1, le=64, exclude_if=lambda value: value is None)
    scenario_hash: str

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> int:
        return _version(value)

    @field_validator("model_hash", "dataset_hash", "scenario_hash")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        return _hash(value)

    @field_validator("simulation_cursor_at", "simulation_end_at", "evidence_cutoff_at")
    @classmethod
    def time_valid(cls, value: datetime) -> datetime:
        return _utc(value)

    @model_validator(mode="after")
    def check_scenario(self):
        if not self.evidence_cutoff_at <= self.simulation_cursor_at <= self.simulation_end_at:
            raise FinanceError("simulation evidence cutoff or cursor is out of order")
        if len({(rule.order_ordinal, rule.fill_ordinal) for rule in self.fee_rules}) \
                != len(self.fee_rules) or len({rule.source_event_id for rule in self.funding_rules}) \
                != len(self.funding_rules) or len({rule.source_event_id for rule in self.outcome_rules}) \
                != len(self.outcome_rules):
            raise FinanceError("simulation economic schedule has duplicate identity")
        if any(not self.simulation_cursor_at <= rule.at_cursor <= self.simulation_end_at
               for rule in (*self.funding_rules, *self.outcome_rules)):
            raise FinanceError("scheduled simulation fact is outside replay time")
        v2 = self.model_version == CAUSAL_MODEL_VERSION
        limits = (self.max_execution_deviation_bps,
                  self.order_time_in_force_ms, self.max_fill_events_per_order)
        if v2 != all(value is not None for value in limits) or \
                not v2 and any(value is not None for value in limits):
            raise FinanceError("causal source limits need one explicit model version")
        if self.scenario_hash != _digest("moeazi-simulation-scenario-v1",
                                         self.model_dump(mode="json", exclude={"scenario_hash"})):
            raise FinanceError("simulation scenario content hash differs")
        return self


class ExperimentProtectionPolicyV1(StrictFinanceModel):
    """Bounded historical exposure policy; never a live stop certificate."""
    schema_version: Literal[1]
    policy_version: Literal["bounded-historical-unprotected-v1"]
    maximum_unprotected_seconds: StrictInt = Field(ge=1, le=3600)
    allow_increases_before_deadline: StrictBool
    deadline_action: Literal["stop_and_escalate"]
    policy_hash: str

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> int:
        return _version(value)

    @field_validator("policy_hash")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        return _hash(value)

    @model_validator(mode="after")
    def content_hash(self):
        if self.policy_hash != _digest("moeazi-experiment-protection-policy-v1",
                self.model_dump(mode="json", exclude={"policy_hash"})):
            raise FinanceError("experiment protection policy content hash differs")
        return self


class SimulationRunManifest(StrictFinanceModel):
    schema_version: Literal[1]
    scope: FinanceScope
    controller_ref: ControllerRef
    controller_mode: CustomerMode
    run_id: str = Field(min_length=1)
    strategy_artifact_hash: str
    policy_version: str = Field(min_length=1)
    policy_hash: str
    instrument_version_ids: tuple[str, ...] = Field(min_length=1)
    evidence_snapshot_hash: str
    account_snapshot_hash: str
    scenario: SimulationScenario
    protection_policy: ExperimentProtectionPolicyV1 | None = Field(
        default=None, exclude_if=lambda value: value is None)
    manifest_hash: str

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> int:
        return _version(value)

    @field_validator("strategy_artifact_hash", "policy_hash", "evidence_snapshot_hash",
                     "account_snapshot_hash", "manifest_hash")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        return _hash(value)

    @model_validator(mode="after")
    def check_manifest(self):
        if self.scope.environment != "experiment" or self.controller_ref.environment != \
                "experiment" or self.controller_ref.strategyAccountId != \
                self.scope.strategy_account_id or self.controller_ref.controllerId != \
                self.scope.scope_id:
            raise FinanceError("run manifest is not bound to its experiment controller")
        if len(set(self.instrument_version_ids)) != len(self.instrument_version_ids):
            raise FinanceError("run manifest repeats an instrument version")
        if self.protection_policy is not None and \
                self.protection_policy.maximum_unprotected_seconds > \
                (self.scenario.simulation_end_at -
                 self.scenario.simulation_cursor_at).total_seconds():
            raise FinanceError("historical protection deadline exceeds replay horizon")
        if self.manifest_hash != _digest("moeazi-simulation-run-v1",
                                         self.model_dump(mode="json", exclude={"manifest_hash"})):
            raise FinanceError("simulation run manifest content hash differs")
        return self
