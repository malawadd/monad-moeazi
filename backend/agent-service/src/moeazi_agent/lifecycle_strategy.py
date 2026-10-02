"""Deterministic research signal; financial owner alone may materialize an intent."""
from __future__ import annotations

from datetime import datetime
from fractions import Fraction
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .finance_contracts import FinanceError, StrictFinanceModel, _digest, _hash, _utc, native_int
from .lifecycle_contracts import TradeAction
from .lifecycle_run_contracts import SimulationRunManifest, simulation_dataset_hash
from .lifecycle_decision import ReplayDecisionContext, build_replay_decision
from .observation_contracts import (
    DECIMAL, EvidenceSnapshot, InstrumentVersion, MarketObservation, canonical_hash,
)


class ReplayStrategyRule(StrictFinanceModel):
    schema_version: Literal[1]
    instrument_version_id: str = Field(min_length=1)
    action: TradeAction
    side: Literal["buy", "sell"]
    trigger: Literal["always", "ask_lte", "bid_gte"]
    threshold_price_quote_per_base: str | None
    desired_quantity_units: str
    horizon_seconds: int = Field(gt=0, le=86_400)
    rationale_summary: str = Field(min_length=1, max_length=500)
    rule_hash: str

    @field_validator("schema_version", mode="before")
    @classmethod
    def version_valid(cls, value: object) -> int:
        if type(value) is not int or value != 1:
            raise FinanceError("strategy rule schema version must be integer 1")
        return value

    @field_validator("rule_hash")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        return _hash(value)

    @field_validator("desired_quantity_units")
    @classmethod
    def units_valid(cls, value: str) -> str:
        native_int(value, positive=True)
        return value

    @field_validator("threshold_price_quote_per_base")
    @classmethod
    def price_valid(cls, value: str | None) -> str | None:
        if value is not None and (not DECIMAL.fullmatch(value) or Fraction(value) <= 0):
            raise FinanceError("strategy threshold needs a positive plain decimal")
        return value

    @model_validator(mode="after")
    def check_rule(self):
        if self.action == "hold" or \
                (self.action == "spot_buy" and self.side != "buy") or \
                (self.action == "spot_sell" and self.side != "sell") or \
                (self.trigger == "ask_lte" and self.side != "buy") or \
                (self.trigger == "bid_gte" and self.side != "sell") or \
                (self.trigger == "always") != (self.threshold_price_quote_per_base is None):
            raise FinanceError("strategy action, side, or threshold is inconsistent")
        if self.rule_hash != _digest("moeazi-replay-strategy-rule-v1",
                                     self.model_dump(mode="json", exclude={"rule_hash"})):
            raise FinanceError("strategy rule content hash differs")
        return self


class ReplayStrategyDraft(StrictFinanceModel):
    schema_version: Literal[1]
    run_manifest_hash: str
    strategy_artifact_hash: str
    evidence_snapshot_hash: str
    rule_hash: str
    instrument_version_id: str
    observation_hash: str
    evaluated_at: datetime
    action: TradeAction
    side: Literal["buy", "sell"] | None
    desired_quantity_units: str
    horizon_seconds: int
    rationale_summary: str
    non_authorizing: Literal[True]
    draft_hash: str

    @field_validator("schema_version", mode="before")
    @classmethod
    def version_valid(cls, value: object) -> int:
        if type(value) is not int or value != 1:
            raise FinanceError("strategy draft schema version must be integer 1")
        return value

    @field_validator("non_authorizing", mode="before")
    @classmethod
    def ceiling_valid(cls, value: object) -> bool:
        if type(value) is not bool or value is not True:
            raise FinanceError("strategy draft must carry an exact nonauthorizing ceiling")
        return value

    @field_validator("run_manifest_hash", "strategy_artifact_hash", "evidence_snapshot_hash",
                     "rule_hash", "observation_hash", "draft_hash")
    @classmethod
    def hash_valid(cls, value: str) -> str:
        return _hash(value)

    @field_validator("evaluated_at")
    @classmethod
    def time_valid(cls, value: datetime) -> datetime:
        return _utc(value)

    @field_validator("desired_quantity_units")
    @classmethod
    def units_valid(cls, value: str) -> str:
        native_int(value, nonnegative=True)
        return value

    @model_validator(mode="after")
    def check_draft(self):
        if (self.action == "hold") != (self.side is None and self.desired_quantity_units == "0") \
                or self.action != "hold" and native_int(self.desired_quantity_units) <= 0:
            raise FinanceError("strategy draft hold identity is inconsistent")
        if self.draft_hash != _digest("moeazi-replay-strategy-draft-v1",
                                      self.model_dump(mode="json", exclude={"draft_hash"})):
            raise FinanceError("strategy draft content hash differs")
        return self


def evaluate_replay_strategy(manifest: SimulationRunManifest,
                             instrument: InstrumentVersion,
                             observations: tuple[MarketObservation, ...],
                             evidence: EvidenceSnapshot,
                             rule: ReplayStrategyRule,
                             decision_context: ReplayDecisionContext | None = None
                             ) -> ReplayStrategyDraft:
    """Return a signal only; no calculation receipt, reservation, or permit."""
    scenario = manifest.scenario
    if manifest.strategy_artifact_hash != rule.rule_hash or \
            rule.instrument_version_id != instrument.instrument_version_id or \
            instrument.instrument_version_id not in manifest.instrument_version_ids or \
            simulation_dataset_hash(observations) != scenario.dataset_hash or \
            (decision_context is None and evidence.snapshot_hash !=
             manifest.evidence_snapshot_hash) or \
            (decision_context is None and evidence.cutoff_at !=
             scenario.evidence_cutoff_at) or \
            instrument.instrument_version_id not in evidence.instrument_version_ids:
        raise FinanceError("strategy rule or dataset differs from frozen run")
    if (rule.action.startswith("spot_") and instrument.product_kind != "spot") or \
            (rule.action.startswith("perp_") and instrument.product_kind != "perpetual"):
        raise FinanceError("strategy action and instrument kind differ")
    cursor = decision_context.cursor_at if decision_context else scenario.simulation_cursor_at
    account_hash = decision_context.account_snapshot_hash if decision_context else \
        manifest.account_snapshot_hash
    expected_context, selected = build_replay_decision(manifest, observations, cursor,
        evidence, instrument_version_id=instrument.instrument_version_id,
        account_snapshot_hash=account_hash)
    if decision_context is not None and decision_context != expected_context:
        raise FinanceError("strategy signal decision context differs from frozen evidence")
    if selected.source_id != instrument.venue_id or \
            selected.event_at < instrument.effective_at or \
            not ((selected.source_kind == "recorded_native" and
                  selected.source_rights_ref == "internal_qualification_only") or
                 (selected.source_kind == "documented_example" and
                  selected.source_rights_ref == "documentation_example_only") or
                 (selected.source_kind == "synthetic_fault" and
                  selected.source_rights_ref == "local_simulation_fixture_only")):
        raise FinanceError("strategy signal source is not registered or reviewed")
    observed = (Fraction(selected.asks[0].price_quote_per_base) if rule.side == "buy"
                else Fraction(selected.bids[0].price_quote_per_base))
    threshold = Fraction(rule.threshold_price_quote_per_base) \
        if rule.threshold_price_quote_per_base is not None else None
    triggered = (rule.trigger == "always" or
                 rule.trigger == "ask_lte" and rule.side == "buy" and
                 threshold is not None and observed <= threshold or
                 rule.trigger == "bid_gte" and rule.side == "sell" and
                 threshold is not None and observed >= threshold)
    body = {
        "schema_version": 1, "run_manifest_hash": manifest.manifest_hash,
        "strategy_artifact_hash": rule.rule_hash,
        "evidence_snapshot_hash": evidence.snapshot_hash,
        "rule_hash": rule.rule_hash,
        "instrument_version_id": instrument.instrument_version_id,
        "observation_hash": canonical_hash(selected.model_dump(mode="json")),
        "evaluated_at": cursor,
        "action": rule.action if triggered else "hold",
        "side": rule.side if triggered else None,
        "desired_quantity_units": rule.desired_quantity_units if triggered else "0",
        "horizon_seconds": rule.horizon_seconds,
        "rationale_summary": rule.rationale_summary if triggered else "Trigger not met",
        "non_authorizing": True,
    }
    body["draft_hash"] = _digest("moeazi-replay-strategy-draft-v1",
        ReplayStrategyDraft.model_construct(**body).model_dump(mode="json", exclude={"draft_hash"}))
    return ReplayStrategyDraft.model_validate(body)
