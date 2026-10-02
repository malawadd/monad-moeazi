"""Strict local fixture contracts; these have no product or execution consumer."""
from __future__ import annotations
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .selective_prediction_canonical import digest, hash_value, utc

class Strict(BaseModel): model_config = ConfigDict(frozen=True, extra="forbid", strict=True)
class SelectivePredictionScope(Strict):
    operator_id: str = Field(pattern=r"^[a-z0-9_-]{3,80}$"); market: str; horizon: str; direction_family: str; regime: str
    tenant_fixture: str; account_fixture: str; purpose: str = "selective-prediction-research"; chain_id: int = 42161; scope_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.chain_id != 42161 or self.scope_hash != digest(self.model_dump(exclude={"scope_hash"})): raise ValueError("scope")
        return self
class ForecastObservation(Strict):
    observation_hash: str; decision_at: str; horizon_ends_at: str; probabilities_bps: tuple[int, int, int]; forecast_return_bps: int
    realized_class: str; realized_return_bps: int; label_observed_at: str; costs_complete: bool = True
    @model_validator(mode="after")
    def valid(self):
        utc(self.decision_at); utc(self.horizon_ends_at); utc(self.label_observed_at)
        if sum(self.probabilities_bps) != 10000 or any(type(x) is not int or x < 0 for x in self.probabilities_bps) or self.realized_class not in {"long","short","neutral"}: raise ValueError("observation")
        hash_value(self.observation_hash); return self
class CalibrationArtifact(Strict):
    artifact_hash: str; sample_count: int = Field(ge=0); direction_threshold_bps: int = Field(ge=0, le=10000); return_threshold_bps: int = Field(ge=0); expires_at: str
    @model_validator(mode="after")
    def valid(self): utc(self.expires_at); hash_value(self.artifact_hash); return self
