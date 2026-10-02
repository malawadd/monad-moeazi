"""Pure replay decision identity; SQL callers prove stored evidence and account state."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .controller_contracts import ControllerRef
from .finance_contracts import FinanceError, FinanceScope, StrictFinanceModel, _digest, _hash, _utc
from .lifecycle_run_contracts import SimulationRunManifest, simulation_dataset_hash
from .observation_contracts import EvidenceSnapshot, MarketObservation, canonical_hash


class ReplayDecisionContext(StrictFinanceModel):
    schema_version: Literal[1]
    scope: FinanceScope
    run_id: str = Field(min_length=1)
    run_manifest_hash: str
    controller_ref: ControllerRef
    instrument_version_id: str = Field(min_length=1)
    cursor_at: datetime
    evidence_cutoff_at: datetime
    evidence_snapshot_hash: str
    account_snapshot_hash: str
    dataset_prefix_count: int = Field(gt=0, le=4096)
    decision_hash: str

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> int:
        if type(value) is not int or value != 1:
            raise FinanceError("decision schema version must be integer 1")
        return value

    @field_validator("dataset_prefix_count", mode="before")
    @classmethod
    def exact_prefix_count(cls, value: object) -> int:
        if type(value) is not int:
            raise FinanceError("decision prefix count must be an integer")
        return value

    @field_validator("run_manifest_hash", "evidence_snapshot_hash",
                     "account_snapshot_hash", "decision_hash")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        return _hash(value)

    @field_validator("cursor_at", "evidence_cutoff_at")
    @classmethod
    def valid_cursor(cls, value: datetime) -> datetime:
        return _utc(value)

    @model_validator(mode="after")
    def check_content(self):
        if self.scope.environment != "experiment" or \
                self.controller_ref.environment != "experiment" or \
                self.controller_ref.strategyAccountId != self.scope.strategy_account_id or \
                self.controller_ref.controllerId != self.scope.scope_id:
            raise FinanceError("replay decision crosses its experimental scope")
        if self.evidence_cutoff_at > self.cursor_at:
            raise FinanceError("replay decision evidence follows its cursor")
        if self.decision_hash != _digest("moeazi-replay-decision-v1",
                                         self.model_dump(mode="json", exclude={"decision_hash"})):
            raise FinanceError("replay decision content hash differs")
        return self


def build_replay_decision(manifest: SimulationRunManifest,
                          frozen_dataset: tuple[MarketObservation, ...],
                          cursor_at: datetime,
                          accepted_evidence: EvidenceSnapshot,
                          *, instrument_version_id: str,
                          account_snapshot_hash: str,
                          ) -> tuple[ReplayDecisionContext, MarketObservation]:
    """Choose the latest pre-cursor frozen book; this result grants no authority."""
    cursor = _utc(cursor_at)
    scenario = manifest.scenario
    if simulation_dataset_hash(frozen_dataset) != scenario.dataset_hash or \
            instrument_version_id not in manifest.instrument_version_ids or \
            not scenario.simulation_cursor_at <= cursor <= scenario.simulation_end_at or \
            not scenario.evidence_cutoff_at <= accepted_evidence.cutoff_at <= cursor or \
            accepted_evidence.has_gap or \
            canonical_hash(accepted_evidence.model_dump(mode="json", exclude={"snapshot_hash"})) \
            != accepted_evidence.snapshot_hash:
        raise FinanceError("replay decision differs from frozen corpus or cursor")
    _hash(account_snapshot_hash)
    by_hash = {canonical_hash(row.model_dump(mode="json")): row for row in frozen_dataset}
    available = {digest: row for digest, row in by_hash.items()
                 if row.event_at <= row.available_at <= accepted_evidence.cutoff_at
                 and row.received_at >= row.available_at}
    if not available or not set(accepted_evidence.accepted_observation_hashes).issubset(available):
        raise FinanceError("decision evidence names unavailable or foreign observations")
    selected = max((row for row in available.values()
                    if row.instrument_version_id == instrument_version_id),
                   key=lambda row: (row.available_at, row.event_at, row.source_event_id),
                   default=None)
    if selected is None or canonical_hash(selected.model_dump(mode="json")) not in \
            accepted_evidence.accepted_observation_hashes or \
            instrument_version_id not in accepted_evidence.instrument_version_ids or \
            selected.source_rights_ref not in accepted_evidence.source_rights_refs:
        raise FinanceError("latest decision book is outside accepted evidence")
    age_ms = (cursor - selected.event_at).total_seconds() * 1000
    if age_ms < 0 or age_ms > scenario.max_book_age_ms:
        raise FinanceError("latest decision book is stale at replay cursor")
    body = dict(schema_version=1, scope=manifest.scope, run_id=manifest.run_id,
                run_manifest_hash=manifest.manifest_hash,
                controller_ref=manifest.controller_ref,
                instrument_version_id=instrument_version_id, cursor_at=cursor,
                evidence_cutoff_at=accepted_evidence.cutoff_at,
                evidence_snapshot_hash=accepted_evidence.snapshot_hash,
                account_snapshot_hash=account_snapshot_hash,
                dataset_prefix_count=len(available))
    body["decision_hash"] = _digest("moeazi-replay-decision-v1",
        ReplayDecisionContext.model_construct(**body).model_dump(mode="json",
                                                        exclude={"decision_hash"}))
    return ReplayDecisionContext.model_validate(body), selected
