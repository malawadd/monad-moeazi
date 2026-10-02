"""Strict, non-executable contracts for Feature 08 local fixtures only."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import Field, model_validator

from .capability_delegation_canonical import digest, normal
from .contracts import StrictModel

HASH = re.compile(r"^[a-f0-9]{64}$")
FINGERPRINT = re.compile(r"^[a-z][a-z0-9:_-]{2,100}$")
GrantType = Literal["eip7702_root", "session_module", "venue_delegate", "operational_credential", "erc20_allowance", "permit2_allowance"]
ObservationState = Literal["active", "expired", "revoked", "drifted", "unknown", "disputed"]


class CapabilityModel(StrictModel):
    @model_validator(mode="before")
    @classmethod
    def no_float_or_non_utc(cls, value: Any):
        normal(value); return value


class CapabilityScope(CapabilityModel):
    tenant_id: str = Field(pattern=r"^tenant:[a-z0-9_-]{2,64}$")
    account_id: str = Field(pattern=r"^account:[a-z0-9_-]{2,64}$")
    owner_provider: Literal["particle_fixture", "magic_fixture"]
    owner_fingerprint: str = Field(pattern=r"^[a-z][a-z0-9:_-]{2,100}$")
    chain_id: Literal[42161]
    venue: Literal["fixture_venue"] | None = None
    scope_key: str = Field(pattern=r"^[a-z][a-z0-9:_-]{2,100}$")


class GrantSpec(CapabilityModel):
    grant_id: str = Field(pattern=r"^grant:[a-z0-9_-]{3,80}$")
    version: int = Field(ge=1, le=1_000_000)
    grant_type: GrantType
    scope: CapabilityScope
    target_fingerprint: str = Field(pattern=r"^[a-z][a-z0-9:_-]{2,100}$")
    certified_code_hash: str | None = None
    selectors: list[str] = Field(max_length=32)
    actions: list[str] = Field(max_length=32)
    token: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9:_-]{2,100}$")
    instrument: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9:_-]{2,100}$")
    market: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9:_-]{2,100}$")
    recipient: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9:_-]{2,100}$")
    per_call_native: int = Field(ge=0, le=10**30)
    daily_native: int = Field(ge=0, le=10**30)
    cumulative_native: int = Field(ge=0, le=10**30)
    gas_native: int = Field(ge=0, le=10**30)
    effective_from: datetime
    effective_until: datetime | None = None
    nonce_domain: str = Field(pattern=r"^[a-z][a-z0-9:_-]{2,100}$")
    parent_hashes: list[str] = Field(max_length=8)
    policy_revision: str = Field(pattern=r"^[a-z0-9._:-]{3,100}$")
    certification_revision: str = Field(pattern=r"^[a-z0-9._:-]{3,100}$")
    revocation_method: Literal["zero_target", "disable_module", "set_allowance_zero", "permit2_lockdown", "venue_revoke", "credential_disable"]
    replacement_group: str | None = Field(default=None, pattern=r"^[a-z0-9:_-]{3,100}$")
    grant_hash: str

    @model_validator(mode="after")
    def valid(self):
        if self.selectors != sorted(set(self.selectors)) or self.actions != sorted(set(self.actions)):
            raise ValueError("grant sets must be sorted and unique")
        if any(not HASH.fullmatch(item) for item in self.parent_hashes):
            raise ValueError("invalid parent hash")
        if self.grant_type == "eip7702_root":
            if self.parent_hashes or self.effective_until is not None:
                raise ValueError("root grant cannot have parents or invented expiry")
        elif self.effective_until is None or self.effective_until <= self.effective_from:
            raise ValueError("subordinate grant needs bounded expiry")
        if self.grant_type in {"eip7702_root", "session_module"} and not self.certified_code_hash:
            raise ValueError("code-bound grant needs certification hash")
        if self.effective_until and self.effective_until <= self.effective_from:
            raise ValueError("grant effective interval is invalid")
        if self.certified_code_hash and not HASH.fullmatch(self.certified_code_hash):
            raise ValueError("invalid code hash")
        if self.grant_hash != digest(self.model_dump(exclude={"grant_hash"})):
            raise ValueError("grant hash mismatch")
        return self


class CapabilityObservation(CapabilityModel):
    grant_hash: str
    scope: CapabilityScope
    native_revision: str = Field(pattern=r"^[a-z0-9._:-]{3,100}$")
    target_fingerprint: str = Field(pattern=r"^[a-z][a-z0-9:_-]{2,100}$")
    code_hash: str | None = None
    permitted_actions: list[str] = Field(max_length=32)
    remaining_native: int = Field(ge=0, le=10**30)
    nonce: int = Field(ge=0, le=10**18)
    observed_at: datetime
    expires_at: datetime
    state: ObservationState
    source_evidence_hash: str
    observation_hash: str

    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(item) for item in (self.grant_hash, self.source_evidence_hash)):
            raise ValueError("invalid observation binding")
        if self.code_hash and not HASH.fullmatch(self.code_hash): raise ValueError("invalid code hash")
        if self.permitted_actions != sorted(set(self.permitted_actions)):
            raise ValueError("actions must be sorted")
        if self.expires_at <= self.observed_at: raise ValueError("observation expiry is invalid")
        if self.observation_hash != digest(self.model_dump(exclude={"observation_hash"})):
            raise ValueError("observation hash mismatch")
        return self


class CapabilityAction(CapabilityModel):
    operation: Literal["inventory", "prepare", "activate", "use", "replace", "revoke", "reconcile", "cancel", "reduce"]
    target_fingerprint: str = Field(pattern=r"^[a-z][a-z0-9:_-]{2,100}$")
    selector: str = Field(pattern=r"^[a-z][a-z0-9:_-]{2,100}$")
    action: str = Field(pattern=r"^[a-z][a-z0-9:_-]{2,100}$")
    token: str | None = None
    instrument: str | None = None
    market: str | None = None
    recipient: str | None = None
    native_value: int = Field(ge=0, le=10**30)
    gas_native: int = Field(ge=0, le=10**30)
    valid_from: datetime
    valid_until: datetime
    nonce: int = Field(ge=0, le=10**18)
    replay_domain: str = Field(pattern=r"^[a-z][a-z0-9:_-]{2,100}$")

    @model_validator(mode="after")
    def valid(self):
        if self.valid_until <= self.valid_from: raise ValueError("action interval invalid")
        if self.native_value == 0 and self.gas_native == 0 and self.operation in {"prepare", "activate", "use", "replace"}:
            raise ValueError("risky action needs an explicit native bound")
        return self


class CapabilityInputManifest(CapabilityModel):
    scope: CapabilityScope
    operation: str
    registry_hash: str
    corpus_hash: str
    grant_hashes: list[str]
    observation_hashes: list[str]
    action_hash: str
    lifecycle_head_hash: str | None = None
    feature05_context_hash: str
    feature06_context_hash: str
    frozen_at: datetime
    idempotency_key: str = Field(min_length=8, max_length=96, pattern=r"^[A-Za-z0-9._:-]+$")
    request_hash: str
    manifest_hash: str

    @model_validator(mode="after")
    def valid(self):
        ordered = [self.grant_hashes, self.observation_hashes]
        if any(items != sorted(set(items)) or any(not HASH.fullmatch(item) for item in items) for items in ordered):
            raise ValueError("manifest hashes must be sorted")
        hashes = (self.registry_hash, self.corpus_hash, self.action_hash, self.feature05_context_hash,
                  self.feature06_context_hash, self.request_hash)
        if not all(HASH.fullmatch(item) for item in hashes): raise ValueError("manifest binding invalid")
        if self.lifecycle_head_hash and not HASH.fullmatch(self.lifecycle_head_hash): raise ValueError("invalid lifecycle head")
        if self.manifest_hash != digest(self.model_dump(exclude={"manifest_hash"})):
            raise ValueError("manifest hash mismatch")
        return self


class CapabilityDecision(CapabilityModel):
    scope: CapabilityScope
    action_hash: str
    input_manifest_hash: str
    required_grant_hashes: list[str]
    required_observation_hashes: list[str]
    ancestry_hash: str
    lifecycle_head_hash: str | None = None
    outcome: Literal["allow", "deny", "unknown", "stale", "close_or_reconcile_only"]
    reasons: list[str] = Field(max_length=16)
    permitted_safe_lanes: list[str] = Field(max_length=4)
    exposure_before_native: int = Field(ge=0)
    exposure_after_native: int = Field(ge=0)
    expires_at: datetime
    idempotency_key: str
    request_hash: str
    decision_hash: str

    @model_validator(mode="after")
    def valid(self):
        for items in (self.required_grant_hashes, self.required_observation_hashes, self.reasons, self.permitted_safe_lanes):
            if items != sorted(set(items)): raise ValueError("decision lists must be sorted")
        hashes = (self.action_hash, self.input_manifest_hash, self.ancestry_hash,
                  self.request_hash, self.decision_hash)
        if not all(HASH.fullmatch(item) for item in hashes):
            raise ValueError("decision binding hash is invalid")
        if self.outcome == "allow" and self.reasons:
            raise ValueError("allowed capability decision has unresolved reasons")
        if self.outcome != "close_or_reconcile_only" and self.permitted_safe_lanes:
            raise ValueError("only a verified safe-lane decision can advertise lanes")
        if self.decision_hash != digest(self.model_dump(exclude={"decision_hash"})):
            raise ValueError("decision hash mismatch")
        return self


class GrantLifecycleTransition(CapabilityModel):
    grant_hash: str; predecessor_hash: str | None = None
    from_state: str; to_state: str
    sequence: int = Field(ge=1); transitioned_at: datetime
    trigger_hash: str; transition_hash: str
    @model_validator(mode="after")
    def valid(self):
        allowed = {"requested", "awaiting_user", "submitted", "active_verified", "submission_unknown",
                   "expiring", "pending_revocation", "revocation_unknown", "verified_revoked"}
        if self.from_state not in allowed or self.to_state not in allowed or not HASH.fullmatch(self.trigger_hash):
            raise ValueError("transition state or trigger is invalid")
        if self.predecessor_hash and not HASH.fullmatch(self.predecessor_hash):
            raise ValueError("transition predecessor is invalid")
        if self.transition_hash != digest(self.model_dump(exclude={"transition_hash"})): raise ValueError("transition hash mismatch")
        return self


class RevocationPlan(CapabilityModel):
    grant_hashes: list[str]; disabled_latch: bool; intents: list[str]; expected_observation_hashes: list[str]
    idempotency_key: str; plan_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not self.disabled_latch or self.grant_hashes != sorted(set(self.grant_hashes)):
            raise ValueError("revocation plan must disable synthetic dispatch")
        if self.plan_hash != digest(self.model_dump(exclude={"plan_hash"})): raise ValueError("plan hash mismatch")
        return self


class RevocationReceipt(CapabilityModel):
    plan_hash: str; state: Literal["requested", "prepared", "submitted", "revocation_unknown", "verified_revoked", "failed"]
    post_observation_hashes: list[str]; residual_grant_hashes: list[str]; residual_native: int = Field(ge=0)
    predecessor_hash: str | None = None; receipt_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.state == "verified_revoked" and (not self.post_observation_hashes or self.residual_native != 0):
            raise ValueError("verified revocation requires exact zero-residual post-state")
        if self.receipt_hash != digest(self.model_dump(exclude={"receipt_hash"})): raise ValueError("receipt hash mismatch")
        return self
