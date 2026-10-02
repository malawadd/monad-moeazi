from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from enum import StrEnum
from hashlib import sha256
import math
from typing import Any, Literal

import orjson
from pydantic import Field, model_validator

from .contracts import StrictModel


class DependencyStatus(StrEnum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    OPEN = "open"
    UNKNOWN = "unknown"
    STALE = "stale"


class FailureDomain(StrEnum):
    EXECUTION = "execution_critical"
    AUTHORITY = "authority_critical"
    EVIDENCE = "evidence_critical"
    OBSERVABILITY = "observability_only"


class SafetyOperation(StrEnum):
    INGEST = "ingest"
    ANALYZE = "analyze"
    RENDER_PREVIOUS = "render_previous"
    SIMULATE = "simulate"
    PROPOSE = "propose"
    REQUEST_APPROVAL = "request_approval"
    PREFLIGHT = "preflight"
    SUBMIT = "submit"
    RECONCILE = "reconcile"


class SafetyScope(StrictModel):
    kind: Literal["global", "tenant", "account", "venue", "market", "workflow"]
    key: str = Field(min_length=1, max_length=180)
    tenant_id: str | None = Field(default=None, max_length=120)
    strategy_account_id: str | None = Field(default=None, max_length=120)
    venue: str | None = Field(default=None, max_length=60)
    market: str | None = Field(default=None, max_length=80)
    workflow_id: str | None = Field(default=None, max_length=160)

    @model_validator(mode="after")
    def canonical_identity(self):
        allowed = {
            "global": set(), "tenant": {"tenant_id"},
            "account": {"strategy_account_id"},
            "venue": {"strategy_account_id", "venue"},
            "market": {"strategy_account_id", "venue", "market"},
            "workflow": {"strategy_account_id", "workflow_id"},
        }[self.kind]
        present = {
            name for name in ("tenant_id", "strategy_account_id", "venue", "market", "workflow_id")
            if getattr(self, name) is not None
        }
        forbidden = present - allowed
        if forbidden:
            raise ValueError(f"{self.kind} scope contains forbidden fields: {sorted(forbidden)}")
        expected = canonical_scope_key(self)
        if self.key != expected:
            raise ValueError(f"Safety scope key is not canonical; expected {expected}")
        return self


class DependencyHealthReceipt(StrictModel):
    schema_version: Literal[1, 2] = 2
    receipt_id: str = Field(min_length=16, max_length=80)
    dependency_id: str = Field(min_length=1, max_length=100)
    failure_domain: FailureDomain
    scope: SafetyScope
    status: DependencyStatus
    observed_at: datetime
    expires_at: datetime
    reason_code: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9_]+$")
    evidence_reference: str | None = Field(default=None, max_length=240)
    source_revision: str = Field(min_length=1, max_length=160)
    adapter_version: str = Field(min_length=1, max_length=80)
    observation_key: str = Field(min_length=1, max_length=180)
    supersedes_receipt_id: str | None = Field(default=None, max_length=80)
    canonical_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def valid_window(self):
        if self.expires_at <= self.observed_at:
            raise ValueError("Dependency receipt expiry must follow observation time")
        return self

    def status_at(self, now: datetime) -> DependencyStatus:
        return DependencyStatus.STALE if self.expires_at <= now else self.status


class SafetyEnvelopeDecision(StrictModel):
    schema_version: Literal[1, 2] = 2
    decision_id: str = Field(min_length=16, max_length=80)
    matrix_version: Literal["dependency-safety-v1", "dependency-safety-v2"] = "dependency-safety-v2"
    mode: Literal["observe", "enforce"]
    operation: SafetyOperation
    subject_key: str = Field(min_length=1, max_length=180)
    scope: SafetyScope
    breaker_state: Literal["closed", "open", "half_open", "recovering"]
    outcome: Literal["allow", "block"]
    reasons: list[str] = Field(max_length=32)
    receipt_hashes: list[str] = Field(max_length=32)
    incident_keys: list[str] = Field(max_length=32)
    bindings: dict[str, str]
    binding_hash: str = Field(default="0" * 64, pattern=r"^[a-f0-9]{64}$")
    request_hash: str = Field(default="0" * 64, pattern=r"^[a-f0-9]{64}$")
    evaluated_at: datetime
    expires_at: datetime
    idempotency_key: str = Field(min_length=1, max_length=180)
    decision_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def bounded_contract(self):
        if self.expires_at < self.evaluated_at:
            raise ValueError("Safety decision expiry cannot precede evaluation time")
        if len(self.bindings) > 16:
            raise ValueError("Safety decision bindings exceed the fixed limit")
        if any(len(key) > 80 or len(value) > 240 for key, value in self.bindings.items()):
            raise ValueError("Safety decision binding is too long")
        return self

    def permits(self, now: datetime) -> bool:
        if self.schema_version != 2 or self.matrix_version != "dependency-safety-v2":
            return False
        if self.expires_at <= now:
            return False
        return self.outcome == "allow" or self.mode == "observe"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def canonical_json(value: Any) -> bytes:
    _reject_floats(value)
    return orjson.dumps(value, option=orjson.OPT_SORT_KEYS)


def digest(value: Any) -> str:
    return sha256(canonical_json(value)).hexdigest()


def canonical_payload_digest(value: Any) -> str:
    return sha256(orjson.dumps(canonical_request_value(value))).hexdigest()


def safety_request_hash(operation: SafetyOperation, request: Any, bindings: dict[str, str]) -> str:
    return canonical_payload_digest({
        "operation": operation.value,
        "request": request,
        "bindings": dict(sorted(bindings.items())),
    })


def canonical_scope_key(scope: SafetyScope) -> str:
    if scope.kind == "global":
        if any((scope.tenant_id, scope.strategy_account_id, scope.venue, scope.market, scope.workflow_id)):
            raise ValueError("Global scope cannot contain narrower identifiers")
        return "global"
    if scope.kind == "tenant":
        if not scope.tenant_id:
            raise ValueError("Tenant scope requires tenant_id")
        return f"tenant:{scope.tenant_id}"
    account = scope.strategy_account_id
    if scope.kind == "account":
        if not account:
            raise ValueError("Account scope requires strategy_account_id")
        return f"account:{account}"
    if scope.kind == "venue":
        if not account or not scope.venue:
            raise ValueError("Venue scope requires account and venue")
        return f"account:{account}:venue:{scope.venue.lower()}"
    if scope.kind == "market":
        if not scope.market:
            raise ValueError("Market scope requires market")
        if scope.venue and not account:
            raise ValueError("A venue-qualified market scope requires an account parent")
        prefix = f"account:{account}" if account else "public"
        venue = f":venue:{scope.venue.lower()}" if scope.venue else ""
        return f"{prefix}{venue}:market:{scope.market.upper()}"
    if not account or not scope.workflow_id:
        raise ValueError("Workflow scope requires account and workflow_id")
    return f"account:{account}:workflow:{scope.workflow_id}"


def receipt_hash_body(receipt: DependencyHealthReceipt) -> dict[str, Any]:
    return {
        "schema_version": receipt.schema_version,
        "dependency_id": receipt.dependency_id,
        "failure_domain": receipt.failure_domain.value,
        "scope": receipt.scope.model_dump(mode="json"),
        "status": receipt.status.value,
        "observed_at": receipt.observed_at.isoformat(),
        "expires_at": receipt.expires_at.isoformat(),
        "reason_code": receipt.reason_code,
        "evidence_reference": receipt.evidence_reference,
        "source_revision": receipt.source_revision,
        "adapter_version": receipt.adapter_version,
        "observation_key": receipt.observation_key,
        "supersedes_receipt_id": receipt.supersedes_receipt_id,
    }


def decision_hash_body(decision: SafetyEnvelopeDecision) -> dict[str, Any]:
    return {
        "schema_version": decision.schema_version,
        "matrix_version": decision.matrix_version,
        "mode": decision.mode,
        "operation": decision.operation.value,
        "subject_key": decision.subject_key,
        "scope": decision.scope.model_dump(mode="json"),
        "breaker_state": decision.breaker_state,
        "outcome": decision.outcome,
        "reasons": decision.reasons,
        "receipt_hashes": decision.receipt_hashes,
        "incident_keys": decision.incident_keys,
        "bindings": dict(sorted(decision.bindings.items())),
        "binding_hash": decision.binding_hash,
        "request_hash": decision.request_hash,
        "evaluated_at": decision.evaluated_at.isoformat(),
        "expires_at": decision.expires_at.isoformat(),
        "idempotency_key": decision.idempotency_key,
    }


def _reject_floats(value: Any) -> None:
    if isinstance(value, float):
        raise ValueError("Dependency safety hashes prohibit floating-point values")
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                raise ValueError("Dependency safety hash keys must be strings")
            _reject_floats(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            _reject_floats(child)


def canonical_request_value(value: Any) -> Any:
    """Type-tagged JSON transform shared with Convex request hashing."""
    if value is None:
        return ["null"]
    if isinstance(value, bool):
        return ["boolean", "true" if value else "false"]
    if isinstance(value, int):
        return ["number", str(value)]
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Safety request numbers must be finite")
        return ["number", _canonical_decimal(repr(value))]
    if isinstance(value, str):
        return ["string", value]
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            raise ValueError("Safety request object keys must be strings")
        return ["object", [[key, canonical_request_value(value[key])] for key in sorted(value)]]
    if isinstance(value, (list, tuple)):
        return ["array", [canonical_request_value(child) for child in value]]
    raise ValueError(f"Unsupported safety request value: {type(value).__name__}")


def _canonical_decimal(source: str) -> str:
    decimal = Decimal(source)
    if not decimal.is_finite():
        raise ValueError("Safety request numbers must be finite")
    if decimal.is_zero():
        return "0"
    sign = "-" if decimal.is_signed() else ""
    digits = "".join(str(item) for item in decimal.as_tuple().digits)
    point = len(digits) + decimal.as_tuple().exponent
    if point <= 0:
        body = "0." + ("0" * -point) + digits
    elif point >= len(digits):
        body = digits + ("0" * (point - len(digits)))
    else:
        body = digits[:point] + "." + digits[point:]
    if "." in body:
        body = body.rstrip("0").rstrip(".")
    return sign + body
