"""Immutable untrusted rulepack contracts. They contain no legal prose."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Literal
from pydantic import Field, model_validator
from .usage_rights_scope_contracts import Frozen, UsageRightsScope
from .usage_rights_canonical import digest
from .usage_rights_registry import obligations, operations, registry_hash


class QualifiedRuleOwnerAttestation(Frozen):
    principal_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    role: Literal["legal", "commercial"]
    source_ids: tuple[str, ...]
    authority_scope_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    provenance: Literal["synthetic_untrusted"] = "synthetic_untrusted"
    effective_at: datetime
    expires_at: datetime
    attestation_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def check(self):
        if not self.source_ids or tuple(sorted(set(self.source_ids))) != self.source_ids or self.expires_at <= self.effective_at:
            raise ValueError("attestation_invalid")
        if self.attestation_hash != digest(self.model_dump(exclude={"attestation_hash"}, mode="python")):
            raise ValueError("attestation_hash_mismatch")
        return self


class UsageRightsAssertion(Frozen):
    assertion_id: str = Field(pattern=r"^assertion:[a-z0-9-]{3,64}$")
    subject_class: Literal["raw", "derived", "mixed", "model"]
    subject_revision: int = Field(ge=1)
    operation: str
    purpose: str = Field(pattern=r"^[a-z_]{3,48}$")
    destination_class: str = Field(pattern=r"^[a-z_]{3,48}$")
    recipient_class: str = Field(pattern=r"^[a-z_]{3,48}$")
    commercial: bool
    adaptation: bool
    max_retention_seconds: int = Field(ge=0)
    max_quantity: int = Field(ge=0)
    disposition: Literal["allow", "deny", "unknown", "manual_legal_review_required"]
    obligations: tuple[str, ...] = ()
    assertion_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def check(self):
        if self.operation not in operations() or tuple(sorted(set(self.obligations))) != self.obligations or not set(self.obligations).issubset(obligations()):
            raise ValueError("assertion_registry_invalid")
        if self.disposition != "allow" and self.obligations:
            raise ValueError("nonallow_obligation_invalid")
        if self.assertion_hash != digest(self.model_dump(exclude={"assertion_hash"}, mode="python")):
            raise ValueError("assertion_hash_mismatch")
        return self


class UsageRightsRulepack(Frozen):
    scope: UsageRightsScope
    rulepack_id: str = Field(pattern=r"^pack:[a-z0-9-]{3,64}$")
    revision: int = Field(ge=1)
    predecessor_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    source_hashes: tuple[str, ...]
    attestation_hashes: tuple[str, ...]
    assertions: tuple[UsageRightsAssertion, ...]
    golden_manifest_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    effective_at: datetime
    expires_at: datetime
    registry_hash: str
    rulepack_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def check(self):
        if self.expires_at <= self.effective_at or (self.revision == 1) != (self.predecessor_hash is None):
            raise ValueError("rulepack_chain_invalid")
        ids = tuple(item.assertion_id for item in self.assertions)
        if not ids or ids != tuple(sorted(set(ids))) or self.source_hashes != tuple(sorted(set(self.source_hashes))) or self.attestation_hashes != tuple(sorted(set(self.attestation_hashes))) or self.registry_hash != registry_hash():
            raise ValueError("rulepack_membership_invalid")
        if self.rulepack_hash != digest(self.model_dump(exclude={"rulepack_hash"}, mode="python")):
            raise ValueError("rulepack_hash_mismatch")
        return self


class GoldenCaseReceipt(Frozen):
    """Independent, metadata-only golden result; it contains no subject or terms."""
    manifest_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    case_id: str = Field(pattern=r"^golden:[a-z0-9-]{3,64}$")
    expected_disposition: Literal["allow", "deny", "unknown", "manual_legal_review_required"]
    expected_fixture_disposition: Literal["permit_fixture", "pending_obligations", "block"]
    passed: bool
    evaluated_at: datetime
    expires_at: datetime
    receipt_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def check(self):
        if self.expires_at <= self.evaluated_at:
            raise ValueError("golden_interval_invalid")
        body = self.model_dump(exclude={"receipt_hash"}, mode="python")
        if self.receipt_hash != digest(body):
            raise ValueError("golden_receipt_hash_mismatch")
        return self


class GoldenCaseManifest(Frozen):
    scope_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    case_receipt_hashes: tuple[str, ...]
    manifest_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def check(self):
        if not self.case_receipt_hashes or self.case_receipt_hashes != tuple(sorted(set(self.case_receipt_hashes))):
            raise ValueError("golden_manifest_membership_invalid")
        if self.manifest_hash != digest(self.model_dump(exclude={"manifest_hash"}, mode="python")):
            raise ValueError("golden_manifest_hash_mismatch")
        return self


class RulepackChange(Frozen):
    scope_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    prior_rulepack_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    candidate_rulepack_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    direction: Literal["tightening", "loosening", "mixed", "deactivate", "rollback"]
    change_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def check(self):
        if self.prior_rulepack_hash is None and self.candidate_rulepack_hash is None:
            raise ValueError("rulepack_change_empty")
        if self.change_hash != digest(self.model_dump(exclude={"change_hash"}, mode="python")):
            raise ValueError("rulepack_change_hash_mismatch")
        return self


class RulepackActivationReceipt(Frozen):
    scope_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    sequence: int = Field(ge=1)
    rulepack_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    predecessor_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    activated_at: datetime
    activation_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def check(self):
        if (self.sequence == 1) != (self.predecessor_hash is None): raise ValueError("activation_predecessor_invalid")
        if self.activation_hash != digest(self.model_dump(exclude={"activation_hash"}, mode="python")):
            raise ValueError("activation_hash_mismatch")
        return self
