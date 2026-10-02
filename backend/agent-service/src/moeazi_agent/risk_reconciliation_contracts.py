"""Strict local-only authoritative-risk fixture contracts; never execution inputs."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import Field, model_validator

from .contracts import StrictModel
from .risk_reconciliation_canonical import digest, normal

HASH = re.compile(r"^[a-f0-9]{64}$")
ID = r"^[a-z][a-z0-9:_-]{2,100}$"
Status = Literal["available", "stale", "missing", "disputed"]


class RiskModel(StrictModel):
    @model_validator(mode="before")
    @classmethod
    def strict_values(cls, value: Any): normal(value); return value


class RiskScope(RiskModel):
    tenant_id: str = Field(pattern=r"^tenant:[a-z0-9_-]{2,64}$")
    account_id: str = Field(pattern=r"^account:[a-z0-9_-]{2,64}$")
    owner_provider: Literal["particle_fixture", "magic_fixture"]
    owner_fingerprint: str = Field(pattern=ID)
    chain_id: Literal[42161]
    venue: Literal["fixture_venue"]
    instrument_fingerprint: str = Field(pattern=ID)
    market_fingerprint: str = Field(pattern=ID)
    scope_key: str = Field(pattern=ID)


class RiskObservation(RiskModel):
    source_id: Literal["product", "portfolio", "credit", "analysis", "quote", "reconciliation"]
    scope: RiskScope; owner_kind: str = Field(pattern=ID); revision: str = Field(pattern=ID)
    observed_at: datetime; expires_at: datetime; status: Status; evidence_hash: str; values: dict[str, int]
    observation_hash: str

    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.evidence_hash) or self.expires_at <= self.observed_at: raise ValueError("invalid observation binding")
        if self.values != {key: self.values[key] for key in sorted(self.values)}: raise ValueError("observation values must be sorted")
        if self.status == "available" and not self.values: raise ValueError("available source needs explicit values")
        if self.observation_hash != digest(self.model_dump(exclude={"observation_hash"})): raise ValueError("observation hash mismatch")
        return self


class RiskInputManifest(RiskModel):
    scope: RiskScope; operation: Literal["snapshot", "reserve", "prepare", "hold", "reconcile", "consume", "release", "reconstruct"]
    registry_hash: str; corpus_hash: str; observation_hashes: list[str]; proposal_hash: str; policy_hash: str; quote_hash: str
    feature08_control_hash: str; prerequisite_closure_hash: str; repository_sha: str = Field(pattern=r"^[a-f0-9]{40}$")
    frozen_at: datetime; idempotency_key: str = Field(min_length=8, max_length=96, pattern=r"^[A-Za-z0-9._:-]+$")
    request_hash: str; manifest_hash: str

    @model_validator(mode="after")
    def valid(self):
        hashes = self.observation_hashes + [self.registry_hash, self.corpus_hash, self.proposal_hash, self.policy_hash, self.quote_hash, self.feature08_control_hash, self.prerequisite_closure_hash, self.request_hash]
        if self.observation_hashes != sorted(set(self.observation_hashes)) or not all(HASH.fullmatch(x) for x in hashes): raise ValueError("invalid manifest hashes")
        request = {"scope": self.scope, "operation": self.operation, "idempotencyKey": self.idempotency_key,
                   "observations": self.observation_hashes}
        if self.request_hash != digest(request): raise ValueError("manifest request binding invalid")
        if self.manifest_hash != digest(self.model_dump(exclude={"manifest_hash"})): raise ValueError("manifest hash mismatch")
        return self


class RiskSnapshot(RiskModel):
    snapshot_id: str = Field(pattern=ID); scope: RiskScope; manifest_hash: str; source_hashes: dict[str, str]
    aggregate: dict[str, int]; outcome: Literal["complete", "blocked", "stale", "missing", "disputed"]
    safe_lanes: list[str]; as_of: datetime; expires_at: datetime; snapshot_hash: str

    @model_validator(mode="after")
    def valid(self):
        required = {"product", "portfolio", "credit", "analysis", "quote", "reconciliation"}
        if (set(self.source_hashes) != required or not HASH.fullmatch(self.manifest_hash)
                or any(not HASH.fullmatch(x) for x in self.source_hashes.values())): raise ValueError("source closure required")
        if self.safe_lanes != sorted(set(self.safe_lanes)) or self.expires_at <= self.as_of: raise ValueError("invalid snapshot bounds")
        if self.outcome == "complete" and self.safe_lanes != ["reconcile", "reserve"]: raise ValueError("complete safe lanes invalid")
        if self.snapshot_hash != digest(self.model_dump(exclude={"snapshot_hash"})): raise ValueError("snapshot hash mismatch")
        return self


class RiskReservation(RiskModel):
    reservation_id: str = Field(pattern=ID); scope: RiskScope; snapshot_hash: str; policy_hash: str; request_hash: str
    idempotency_key: str; deltas: dict[str, int]; state: Literal["requested", "reserved", "consumed", "released", "expired", "reconciliation_hold", "conflict"]
    expires_at: datetime; reservation_hash: str

    @model_validator(mode="after")
    def valid(self):
        if (not self.deltas or any(value < 0 for value in self.deltas.values()) or not all(HASH.fullmatch(x)
                for x in (self.snapshot_hash, self.policy_hash, self.request_hash, self.reservation_hash))):
            raise ValueError("invalid reservation")
        if self.reservation_hash != digest(self.model_dump(exclude={"reservation_hash"})): raise ValueError("reservation hash mismatch")
        return self


class ExecutionAttemptReceipt(RiskModel):
    attempt_id: str = Field(pattern=ID); snapshot_hash: str; reservation_hash: str; quote_hash: str; action_summary_hash: str
    state: Literal["failed", "prepared", "possible_submission", "rejected", "included", "reorged"]
    prepared_payload_hash: str | None = None; observed_at: datetime; error_code: str | None = Field(default=None, pattern=ID)
    receipt_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.state == "prepared" and not self.prepared_payload_hash: raise ValueError("prepared identity required")
        hashes = (self.snapshot_hash, self.reservation_hash, self.quote_hash, self.action_summary_hash, self.receipt_hash)
        if not all(HASH.fullmatch(item) for item in hashes) or (self.prepared_payload_hash and not HASH.fullmatch(self.prepared_payload_hash)):
            raise ValueError("attempt binding invalid")
        if self.receipt_hash != digest(self.model_dump(exclude={"receipt_hash"})): raise ValueError("attempt hash mismatch")
        return self


class ReconciliationReceipt(RiskModel):
    attempt_hash: str; snapshot_hash: str; reservation_hash: str; expected_state_hash: str; observed_state_hash: str
    outcome: Literal["clear", "partial", "drift", "unresolved", "reorged", "failed"]
    reservation_disposition: Literal["consumed", "released", "reconciliation_hold"]; watermark: int = Field(ge=0)
    comparison_hash: str; receipt_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.outcome == "clear" and self.reservation_disposition not in {"consumed", "released"}: raise ValueError("clear needs terminal disposition")
        if self.outcome != "clear" and self.reservation_disposition != "reconciliation_hold": raise ValueError("uncertain reconciliation holds capacity")
        hashes = (self.attempt_hash, self.snapshot_hash, self.reservation_hash, self.expected_state_hash,
                  self.observed_state_hash, self.comparison_hash, self.receipt_hash)
        if not all(HASH.fullmatch(item) for item in hashes): raise ValueError("reconciliation binding invalid")
        if self.receipt_hash != digest(self.model_dump(exclude={"receipt_hash"})): raise ValueError("reconciliation hash mismatch")
        return self
