"""Strict local fixture contracts; these are never wallet, venue, or execution inputs."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import Field, model_validator

from .asset_journal_canonical import digest, exact_amount, normal
from .contracts import StrictModel

HASH = re.compile(r"^[a-f0-9]{64}$")
ID = r"^[a-z][a-z0-9:_-]{2,100}$"


class JournalModel(StrictModel):
    @model_validator(mode="before")
    @classmethod
    def strict(cls, value: Any): normal(value); return value


class JournalScope(JournalModel):
    tenant_id: str = Field(pattern=r"^tenant:[a-z0-9_-]{2,64}$")
    account_id: str = Field(pattern=r"^account:[a-z0-9_-]{2,64}$")
    owner_provider: Literal["particle_fixture", "magic_fixture"]
    owner_fingerprint: str = Field(pattern=ID); chain_id: Literal[42161]; scope_key: str = Field(pattern=ID)
    scope_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.scope_hash != digest(self.model_dump(exclude={"scope_hash"})): raise ValueError("scope hash mismatch")
        return self


class AssetUnit(JournalModel):
    unit_id: str = Field(pattern=ID); domain: Literal["arbitrum_wallet", "fixture_venue", "bridge_transit", "external_boundary"]
    locator: str = Field(pattern=r"^asset:[a-z0-9:_-]{3,120}$"); decimals: int = Field(ge=0, le=36)
    definition_revision: str = Field(pattern=ID); instrument_context_hash: str; certification_hash: str; unit_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.instrument_context_hash, self.certification_hash)): raise ValueError("invalid unit evidence")
        if self.unit_hash != digest(self.model_dump(exclude={"unit_hash"})): raise ValueError("unit hash mismatch")
        return self


class JournalAccount(JournalModel):
    account_id: str = Field(pattern=ID); scope_hash: str; location: str = Field(pattern=ID)
    bucket: Literal["wallet_available", "venue_available", "venue_locked", "pending_settlement", "bridge_in_transit", "fee_expense", "funding_settlement", "realized_pnl", "external_counterparty", "opening_boundary"]
    unit_hash: str; account_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in (self.scope_hash, self.unit_hash)): raise ValueError("invalid account binding")
        if self.account_hash != digest(self.model_dump(exclude={"account_hash"})): raise ValueError("account hash mismatch")
        return self


class SourceEvent(JournalModel):
    source_owner: str = Field(pattern=ID); source_stream: str = Field(pattern=ID); event_id: str = Field(pattern=ID)
    revision: str = Field(pattern=ID); sequence: int = Field(ge=0); event_class: str = Field(pattern=ID); scope_hash: str
    effective_at: datetime; observed_at: datetime; finality: Literal["pending", "safe", "finalized", "reorged", "disputed", "unknown"]
    evidence_hash: str; payload_hash: str; predecessor_hash: str | None = None; event_hash: str
    @model_validator(mode="after")
    def valid(self):
        hashes = [self.scope_hash, self.evidence_hash, self.payload_hash] + ([self.predecessor_hash] if self.predecessor_hash else [])
        if not all(HASH.fullmatch(x) for x in hashes): raise ValueError("invalid source binding")
        if self.event_hash != digest(self.model_dump(exclude={"event_hash"})): raise ValueError("event hash mismatch")
        return self


class PostingCandidate(JournalModel):
    ordinal: int = Field(ge=1); account_hash: str; unit_hash: str; side: Literal["debit", "credit"]
    amount: str; source_leg: str = Field(pattern=ID); candidate_hash: str
    @model_validator(mode="after")
    def valid(self):
        exact_amount(self.amount)
        if not all(HASH.fullmatch(x) for x in (self.account_hash, self.unit_hash)): raise ValueError("invalid candidate binding")
        body = {"ordinal": self.ordinal, "account_hash": self.account_hash, "unit_hash": self.unit_hash,
            "side": self.side, "amount": self.amount, "source_leg": self.source_leg}
        if self.candidate_hash != digest(body): raise ValueError("candidate hash mismatch")
        return self


class JournalPosting(PostingCandidate):
    transaction_id: str = Field(pattern=ID); posting_hash: str
    @model_validator(mode="after")
    def posting_valid(self):
        body = {"transaction_id": self.transaction_id, "ordinal": self.ordinal, "account_hash": self.account_hash,
            "unit_hash": self.unit_hash, "side": self.side, "amount": self.amount, "source_leg": self.source_leg}
        if self.posting_hash != digest(body): raise ValueError("posting hash mismatch")
        return self


class JournalManifest(JournalModel):
    scope: JournalScope; operation: Literal["register", "propose", "check", "commit", "replay", "post", "settle_existing", "void", "expire", "reorg", "correct", "catch_up", "reconcile"]
    registry_hash: str; corpus_hash: str; expectation_hash: str; unit_hashes: list[str]; account_hashes: list[str]; source_hashes: list[str]; candidate_hashes: list[str]
    repository_sha: str = Field(pattern=r"^[a-f0-9]{40}$"); prerequisite_closure_hash: str; prerequisite_status: Literal["requires_revalidation"]
    idempotency_key: str = Field(min_length=8, max_length=96, pattern=r"^[A-Za-z0-9._:-]+$"); request_hash: str; frozen_at: datetime; manifest_hash: str
    @model_validator(mode="after")
    def valid(self):
        sets = (self.unit_hashes, self.account_hashes, self.source_hashes, self.candidate_hashes)
        if any(item != sorted(set(item)) for item in sets): raise ValueError("manifest lists must be sorted and unique")
        hashes = [self.registry_hash, self.corpus_hash, self.expectation_hash, self.prerequisite_closure_hash, self.request_hash] + [x for item in sets for x in item]
        if not all(HASH.fullmatch(x) for x in hashes): raise ValueError("invalid manifest binding")
        if self.manifest_hash != digest(self.model_dump(exclude={"manifest_hash"})): raise ValueError("manifest hash mismatch")
        return self


class ConservationCheck(JournalModel):
    outcome: Literal["balanced", "partial", "unknown", "mismatch"]; totals: dict[str, dict[str, str]]; reasons: list[str]; safe_lanes: list[str]; check_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.reasons != sorted(set(self.reasons)) or self.safe_lanes != sorted(set(self.safe_lanes)): raise ValueError("check lists must be sorted")
        for unit, total in self.totals.items():
            if not HASH.fullmatch(unit) or set(total) != {"debit", "credit", "delta"}: raise ValueError("invalid totals")
            for key in ("debit", "credit"):
                if not isinstance(total[key], str) or not re.fullmatch(r"0|[1-9][0-9]*", total[key]) or int(total[key]) > 2**256 - 1:
                    raise ValueError("invalid exact total")
            if not re.fullmatch(r"-?(0|[1-9][0-9]*)", total["delta"]): raise ValueError("invalid delta")
        if self.check_hash != digest(self.model_dump(exclude={"check_hash"})): raise ValueError("check hash mismatch")
        return self


class JournalReceipt(JournalModel):
    receipt_id: str = Field(pattern=ID); scope_hash: str; idempotency_key: str; request_hash: str; manifest_hash: str; check_hash: str
    transaction_hash: str | None = None; outcome: Literal["committed", "replayed", "rejected", "conflict"]; predecessor_hash: str | None = None; receipt_hash: str
    @model_validator(mode="after")
    def valid(self):
        hashes = [self.scope_hash, self.request_hash, self.manifest_hash, self.check_hash] + ([self.transaction_hash] if self.transaction_hash else []) + ([self.predecessor_hash] if self.predecessor_hash else [])
        if not all(HASH.fullmatch(x) for x in hashes): raise ValueError("invalid receipt binding")
        if self.receipt_hash != digest(self.model_dump(exclude={"receipt_hash"})): raise ValueError("receipt hash mismatch")
        return self
