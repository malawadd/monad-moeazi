"""Operation decisions and obligation closure; never a product permission."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Literal
from pydantic import Field, model_validator
from .usage_rights_scope_contracts import Feature03ContextBinding, Frozen, UsageRightsScope
from .usage_rights_subject_contracts import UsageSubjectSpec
from .usage_rights_canonical import digest
from .usage_rights_registry import limit, operations


class UsageOperationRequest(Frozen):
    scope: UsageRightsScope
    subject: UsageSubjectSpec
    operation: str
    purpose: str = Field(pattern=r"^[a-z_]{3,48}$")
    destination_class: str = Field(pattern=r"^[a-z_]{3,48}$")
    recipient_class: str = Field(pattern=r"^[a-z_]{3,48}$")
    commercial: bool
    adaptation: bool
    retention_seconds: int = Field(ge=0)
    quantity: int = Field(ge=0)
    requested_at: datetime
    feature03_context: Feature03ContextBinding | None
    idempotency_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    request_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def check(self):
        if self.operation not in operations() or self.retention_seconds > limit("maxRetentionSeconds") or self.quantity > limit("maxQuantity"):
            raise ValueError("operation_request_invalid")
        if self.requested_at.tzinfo is None or self.requested_at.utcoffset() != timezone.utc.utcoffset(self.requested_at):
            raise ValueError("request_utc_required")
        if self.subject.scope.scope_hash != self.scope.scope_hash or (self.feature03_context and (self.feature03_context.scope_hash != self.scope.scope_hash)):
            raise ValueError("request_scope_mismatch")
        body = self.model_dump(exclude={"request_hash"}, mode="python")
        if self.request_hash != digest(body): raise ValueError("request_hash_mismatch")
        return self


class UsageLeafMatch(Frozen):
    leaf_id: str
    assertion_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    disposition: Literal["allow", "deny", "unknown", "manual_legal_review_required"]
    reason_code: str


class UsageRightsDecision(Frozen):
    request_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    rulepack_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    disposition: Literal["allow", "deny", "unknown", "manual_legal_review_required"]
    fixture_disposition: Literal["permit_fixture", "pending_obligations", "block"]
    leaf_matches: tuple[UsageLeafMatch, ...]
    required_obligations: tuple[str, ...] = ()
    fulfilled_obligations: tuple[str, ...] = ()
    expires_at: datetime
    predecessor_decision_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    fixture_only: Literal[True] = True
    accepted_for_product: Literal[False] = False
    operation_performed: Literal[False] = False
    product_outcome: Literal["unavailable"] = "unavailable"
    authority_effect: Literal["none"] = "none"
    external_attempts: Literal[0] = 0
    provider_cost: Literal[0] = 0
    decision_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def check(self):
        if tuple(sorted(set(self.required_obligations))) != self.required_obligations or tuple(sorted(set(self.fulfilled_obligations))) != self.fulfilled_obligations:
            raise ValueError("decision_obligations_invalid")
        if not set(self.fulfilled_obligations).issubset(self.required_obligations):
            raise ValueError("decision_fulfillment_invalid")
        leaf_ids = tuple(item.leaf_id for item in self.leaf_matches)
        if not leaf_ids or leaf_ids != tuple(sorted(set(leaf_ids))):
            raise ValueError("decision_lineage_invalid")
        expected = "block" if self.disposition != "allow" else "permit_fixture" if set(self.required_obligations) <= set(self.fulfilled_obligations) else "pending_obligations"
        if self.fixture_disposition != expected: raise ValueError("decision_fixture_disposition_invalid")
        if self.decision_hash != digest(self.model_dump(exclude={"decision_hash"}, mode="python")):
            raise ValueError("decision_hash_mismatch")
        return self


class UsageObligationReceipt(Frozen):
    decision_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    obligation: str
    output_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    fulfiller_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    status: Literal["fulfilled", "failed"]
    fulfilled_at: datetime
    receipt_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def check(self):
        if self.obligation not in __import__("moeazi_agent.usage_rights_registry", fromlist=["obligations"]).obligations():
            raise ValueError("unknown_obligation")
        if self.receipt_hash != digest(self.model_dump(exclude={"receipt_hash"}, mode="python")):
            raise ValueError("obligation_receipt_hash_mismatch")
        return self


def safe_projection(decision: UsageRightsDecision) -> dict:
    return {"disposition": decision.disposition, "fixtureDisposition": decision.fixture_disposition,
            "lineageLeafCount": len(decision.leaf_matches), "requiredObligationCount": len(decision.required_obligations),
            "fulfilledObligationCount": len(decision.fulfilled_obligations), "decisionHash": decision.decision_hash[:16],
            "fixtureOnly": True, "productOutcome": "unavailable", "authorityEffect": "none",
            "operationPerformed": False, "externalAttempts": 0, "providerCost": 0}
