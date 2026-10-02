"""Strict, hash-bound contracts for inert Intent–Execution fixtures only."""
from __future__ import annotations
import re
from datetime import datetime
from typing import Any, Literal
from pydantic import Field, model_validator
from .contracts import StrictModel
from .intent_equivalence_canonical import HASH, digest, exact_uint, normal, strict_hex

ID = r"^[a-z][a-z0-9:_-]{2,100}$"

class Model(StrictModel):
    @model_validator(mode="before")
    @classmethod
    def canonical(cls, value: Any): normal(value); return value

class Bound(Model):
    @classmethod
    def validate_hash(cls, instance, field: str):
        if getattr(instance, field) != digest(instance.model_dump(exclude={field})): raise ValueError(f"{field} mismatch")
        return instance

class EquivalenceScope(Bound):
    tenant_id: str = Field(pattern=r"^tenant:[a-z0-9_-]{2,64}$"); account_id: str = Field(pattern=r"^account:[a-z0-9_-]{2,64}$")
    owner_provider: Literal["particle_fixture", "magic_fixture"]; owner_fingerprint: str = Field(pattern=ID)
    chain_id: Literal[42161]; scope_key: str = Field(pattern=ID); scope_hash: str
    @model_validator(mode="after")
    def valid(self): return self.validate_hash(self, "scope_hash")

class ReviewedIntent(Bound):
    scope: EquivalenceScope; intent_id: str = Field(pattern=ID); proposal_id: str = Field(pattern=ID); revision: int = Field(ge=1)
    operation: Literal["universal_router_exact_in"]; sender_hash: str; account_hash: str; target_hash: str; recipient_hash: str
    input_units: list[str]; output_units: list[str]; requested_input: str; max_input: str; max_value: str; max_gas: str; min_output: str
    deadline: datetime; allowed_selectors: list[str]; allowed_commands: list[str]; allow_revert: bool; postcondition_hashes: list[str]
    created_at: datetime; expires_at: datetime; intent_hash: str
    @model_validator(mode="after")
    def valid(self):
        for value in (self.requested_input, self.max_input, self.max_value, self.max_gas, self.min_output): exact_uint(value, positive=value in {self.requested_input, self.min_output})
        if self.input_units != sorted(set(self.input_units)) or self.output_units != sorted(set(self.output_units)) or self.postcondition_hashes != sorted(set(self.postcondition_hashes)): raise ValueError("set arrays must be sorted")
        if not all(HASH.fullmatch(x) for x in [self.sender_hash, self.account_hash, self.target_hash, self.recipient_hash, *self.input_units, *self.output_units, *self.postcondition_hashes]): raise ValueError("invalid intent hash")
        return self.validate_hash(self, "intent_hash")

class DependencyBinding(Bound):
    binding_id: str = Field(pattern=ID); scope_hash: str; reviewed_hash: str; expires_at: datetime; binding_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not HASH.fullmatch(self.scope_hash) or not HASH.fullmatch(self.reviewed_hash): raise ValueError("invalid dependency binding")
        return self.validate_hash(self, "binding_hash")

class Feature10Binding(Bound):
    scope_hash: str; run_hash: str; bundle_hash: str; manifest_hash: str; check_hash: str; receipt_hash: str; control_closure_hash: str
    reported_outcome: Literal["balanced", "partial", "unknown", "mismatch"]; product_outcome: Literal["unavailable"]
    status: Literal["requires_revalidation"]; binding_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in [self.scope_hash,self.run_hash,self.bundle_hash,self.manifest_hash,self.check_hash,self.receipt_hash,self.control_closure_hash]): raise ValueError("invalid feature 10 binding")
        return self.validate_hash(self, "binding_hash")

class ApprovalBinding(Bound):
    scope_hash: str; approval_id: str = Field(pattern=ID); revision: int = Field(ge=1); intent_hash: str; owner_hash: str
    decision: Literal["approved"]; approved_at: datetime; expires_at: datetime; max_input: str; max_value: str; max_gas: str
    policy_hash: str; quote_hash: str; route_hash: str; approval_hash: str
    @model_validator(mode="after")
    def valid(self):
        for item in (self.max_input, self.max_value, self.max_gas): exact_uint(item)
        return self.validate_hash(self, "approval_hash")

class PolicySnapshot(Bound):
    scope_hash: str; policy_id: str = Field(pattern=ID); version: str = Field(pattern=ID); status: Literal["active"]
    operation: Literal["universal_router_exact_in"]; targets: list[str]; recipients: list[str]; assets: list[str]; selectors: list[str]; commands: list[str]
    max_input: str; max_value: str; max_gas: str; min_output: str; max_slippage_bps: int = Field(ge=0, le=10000)
    deadline: datetime; allow_revert: bool; observed_at: datetime; expires_at: datetime; policy_hash: str
    @model_validator(mode="after")
    def valid(self):
        for item in (self.targets,self.recipients,self.assets,self.selectors,self.commands):
            if item != sorted(set(item)): raise ValueError("policy sets must be sorted")
        for item in (self.max_input,self.max_value,self.max_gas,self.min_output): exact_uint(item)
        return self.validate_hash(self, "policy_hash")

class QuoteSnapshot(Bound):
    scope_hash: str; quote_id: str = Field(pattern=ID); version: str = Field(pattern=ID); input_unit: str; output_unit: str
    exact_input: str; quoted_output: str; min_output: str; fee_components: list[str]; route_hash: str; block_number: str; block_hash: str
    observed_at: datetime; expires_at: datetime; quote_hash: str
    @model_validator(mode="after")
    def valid(self):
        for item in (self.exact_input,self.quoted_output,self.min_output,self.block_number,*self.fee_components): exact_uint(item)
        return self.validate_hash(self, "quote_hash")

class RoutePlan(Bound):
    scope_hash: str; route_id: str = Field(pattern=ID); version: str = Field(pattern=ID); quote_hash: str; target_hash: str
    hops: list[str]; commands: list[str]; recipient_hash: str; input_unit: str; output_unit: str; max_input: str; min_output: str
    deadline: datetime; certification_hash: str; observed_at: datetime; expires_at: datetime; route_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not self.hops or not self.commands: raise ValueError("route requires ordered hops and commands")
        exact_uint(self.max_input); exact_uint(self.min_output)
        return self.validate_hash(self, "route_hash")

class ReviewedExecutionEnvelope(Bound):
    scope: EquivalenceScope; intent_hash: str; approval_hash: str; policy_hash: str; quote_hash: str; route_hash: str; feature10_hash: str
    risk_hash: str; reconciliation_hash: str; certification_hash: str; capability_hash: str; registry_hash: str; corpus_hash: str
    repository_sha: str = Field(pattern=r"^[a-f0-9]{40}$"); idempotency_key: str = Field(min_length=8, max_length=96, pattern=r"^[A-Za-z0-9._:-]+$")
    frozen_at: datetime; expires_at: datetime; envelope_hash: str
    @model_validator(mode="after")
    def valid(self):
        if not all(HASH.fullmatch(x) for x in self.model_dump(include={"intent_hash","approval_hash","policy_hash","quote_hash","route_hash","feature10_hash","risk_hash","reconciliation_hash","certification_hash","capability_hash","registry_hash","corpus_hash"}).values()): raise ValueError("invalid envelope hash")
        return self.validate_hash(self, "envelope_hash")

class DispatchArtifactObservation(Bound):
    stage: Literal["prepared", "signing_request", "dispatch"]; envelope_hash: str; kind: Literal["calldata", "eip712"]
    inert_hex: str; typed_data_hash: str | None = None; artifact_hash: str; sender_hash: str; account_hash: str; target_hash: str
    chain_id: Literal[42161]; value: str; gas: str; nonce: str; deadline: datetime; target_code_hash: str; certification_hash: str
    sequence: int = Field(ge=1, le=3); observed_at: datetime; observation_hash: str
    @model_validator(mode="after")
    def valid(self):
        strict_hex(self.inert_hex); exact_uint(self.value); exact_uint(self.gas, bits=64); exact_uint(self.nonce)
        if self.artifact_hash != digest({"kind": self.kind, "inert_hex": self.inert_hex, "typed_data_hash": self.typed_data_hash}): raise ValueError("artifact hash mismatch")
        if not all(HASH.fullmatch(x) for x in [self.envelope_hash,self.artifact_hash,self.sender_hash,self.account_hash,self.target_hash,self.target_code_hash,self.certification_hash] + ([self.typed_data_hash] if self.typed_data_hash else [])): raise ValueError("invalid artifact binding")
        return self.validate_hash(self, "observation_hash")

class DecodedOperation(Bound):
    path: str = Field(pattern=r"^/[0-9]+(?:/[0-9]+){0,7}$"); kind: Literal["exact_input", "permit2_transfer", "wrap", "sweep", "subplan"]
    target_hash: str; recipient_hash: str; input_unit: str | None = None; output_unit: str | None = None; amount: str | None = None; min_output: str | None = None
    deadline: datetime | None = None; nonce: str | None = None; allow_revert: bool = False; child_hashes: list[str] = []; operation_hash: str
    @model_validator(mode="after")
    def valid(self):
        for value in (self.amount, self.min_output, self.nonce):
            if value is not None: exact_uint(value, positive=value != self.nonce)
        if self.child_hashes != sorted(self.child_hashes): raise ValueError("child hashes retain canonical order")
        return self.validate_hash(self, "operation_hash")

class DecodedExecutionPlan(Bound):
    artifact_hash: str; operation_hashes: list[str]; root_hash: str; target_hashes: list[str]; recipient_hashes: list[str]; asset_hashes: list[str]
    max_input: str; min_output: str; max_value: str; max_gas: str; deadline: datetime; nonces: list[str]; depth: int; byte_count: int; node_count: int; command_count: int
    decoder_version: str = Field(pattern=ID); certification_hash: str; complete: bool; unknown_reasons: list[str]; plan_hash: str
    @model_validator(mode="after")
    def valid(self):
        for value in (self.max_input,self.min_output,self.max_value,self.max_gas): exact_uint(value)
        if any(items != sorted(set(items)) for items in (self.target_hashes,self.recipient_hashes,self.asset_hashes,self.unknown_reasons)): raise ValueError("plan sets must be sorted")
        return self.validate_hash(self, "plan_hash")

class SyntheticSimulationContext(Bound):
    scope_hash: str; sender_hash: str; account_hash: str; block_number: str; block_hash: str; prestate_hash: str; code_hash: str; config_hash: str; certification_hash: str
    logical_clock: datetime; expires_at: datetime; context_hash: str
    @model_validator(mode="after")
    def valid(self): exact_uint(self.block_number, bits=64); return self.validate_hash(self, "context_hash")

class ObservedStateDelta(Bound):
    ordinal: int = Field(ge=1, le=128); kind: Literal["balance", "allowance", "nonce", "log", "call", "gas"]
    subject_hash: str; unit_hash: str | None = None; counterparty_hash: str | None = None; before: str; after: str; delta: str
    expected_postcondition_hash: str | None = None; classification: Literal["expected", "permitted", "unexplained"]; delta_hash: str
    @model_validator(mode="after")
    def valid(self): return self.validate_hash(self, "delta_hash")

class EquivalenceCheck(Bound):
    path: str = Field(min_length=2, max_length=160); comparator: str = Field(pattern=r"^[a-z0-9_:-]{2,48}$")
    reviewed: str | None = None; observed: str | None = None; outcome: Literal["pass", "fail", "unknown"]; reason_code: str = Field(pattern=r"^[a-z0-9_:-]{2,80}$"); check_hash: str
    @model_validator(mode="after")
    def valid(self): return self.validate_hash(self, "check_hash")

class IntentEquivalenceReceipt(Bound):
    scope_hash: str; envelope_hash: str; artifact_hashes: list[str]; plan_hash: str; context_hash: str; delta_hashes: list[str]; check_hashes: list[str]
    stage_parity_hash: str; registry_hash: str; corpus_hash: str; repository_sha: str = Field(pattern=r"^[a-f0-9]{40}$")
    issued_at: datetime; expires_at: datetime; outcome: Literal["pass", "fail", "unknown"]; reasons: list[str]; receipt_hash: str
    @model_validator(mode="after")
    def valid(self):
        if self.reasons != sorted(set(self.reasons)): raise ValueError("receipt reasons must be sorted")
        return self.validate_hash(self, "receipt_hash")
