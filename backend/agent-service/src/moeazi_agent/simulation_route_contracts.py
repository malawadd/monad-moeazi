"""Strict authenticated simulation request wires; no caller-selected account."""
from datetime import datetime

from pydantic import Field, field_validator, model_validator

from .finance_contracts import StrictFinanceModel, _hash, _utc
from .finance_observation_contracts import AccountObservationSnapshotRef
from .finance_policy import SizingPolicy
from .lifecycle_run_contracts import SimulationRunManifest
from .lifecycle_strategy import ReplayStrategyRule
from .simulation_workflow_contracts import SimulationControl


class RunRegistration(StrictFinanceModel):
    manifest: SimulationRunManifest
    expected_revision: int = Field(ge=0)
    idempotency_key: str = Field(min_length=16, max_length=128, pattern=r"^[a-zA-Z0-9:_-]+$")


class RunLookup(StrictFinanceModel):
    experiment_spec_id: str = Field(min_length=1, max_length=160)
    run_id: str = Field(min_length=1, max_length=256)
    manifest_hash: str

    @field_validator("manifest_hash")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        return _hash(value)


class RunControl(RunLookup):
    control: SimulationControl


class RunApproval(RunLookup):
    intent_id: str = Field(min_length=1, max_length=256)
    normalized_payload_hash: str
    expires_at: datetime
    command_id: str = Field(min_length=1, max_length=160)

    @field_validator("normalized_payload_hash")
    @classmethod
    def payload_hash(cls, value: str) -> str:
        return _hash(value)

    @field_validator("expires_at")
    @classmethod
    def expiry(cls, value: datetime) -> datetime:
        return _utc(value)


class ApprovalRevocation(RunLookup):
    approval_hash: str

    @field_validator("approval_hash")
    @classmethod
    def receipt_hash(cls, value: str) -> str:
        return _hash(value)


class EntryRequest(RunLookup):
    request_id: str = Field(min_length=1, max_length=160)
    rule: ReplayStrategyRule


class OrderReview(RunLookup):
    after_ordinal: int = Field(default=0, ge=0)


class PortfolioReview(RunLookup):
    after_instrument: str = Field(default="", max_length=256)
    after_location: str = Field(default="", max_length=256)

    @model_validator(mode="after")
    def paired_cursor(self):
        if bool(self.after_instrument) != bool(self.after_location):
            raise ValueError("Portfolio page cursor needs instrument and location")
        return self


class DatasetRegistration(RunLookup):
    observation_hashes: tuple[str, ...] = Field(min_length=1, max_length=4096)

    @field_validator("observation_hashes")
    @classmethod
    def hashes(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        for item in value:
            _hash(item)
        if len(set(value)) != len(value):
            raise ValueError("Dataset repeats an observation")
        return value


class ExperimentAccountBootstrap(StrictFinanceModel):
    experiment_spec_id: str = Field(min_length=1, max_length=160)
    snapshot: AccountObservationSnapshotRef
    policy: SizingPolicy
    idempotency_key: str = Field(min_length=16, max_length=128,
                                 pattern=r"^[a-zA-Z0-9:_-]+$")
