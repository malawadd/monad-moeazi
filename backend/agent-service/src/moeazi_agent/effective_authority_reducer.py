"""Pure fail-closed reduction; it never invokes owners or performs domain arithmetic."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .effective_authority_canonical import digest
from .effective_authority_decision_contracts import EffectiveAuthorityDecision, ReasonProjection
from .effective_authority_gate_contracts import GateResult
from .effective_authority_registry import applicable, gate as registry_gate, registry_hash
from .effective_authority_scope_contracts import ProjectionRequest

ORDER = {"ANALYZE_ONLY": 0, "SHADOW_SIMULATE": 1, "PREFLIGHT_ONLY": 2, "SUBMISSION_ELIGIBLE": 3}


def _utc(now: datetime) -> None:
    if now.tzinfo is None or now.utcoffset() != timezone.utc.utcoffset(now) or now.microsecond % 1000:
        raise ValueError("utc_millisecond_now_required")


def _reason(gate_id: str, code: str, remediation: str = "REVIEW_FIXTURE") -> ReasonProjection:
    return ReasonProjection(gate_id=gate_id, reason_code=code, remediation_code=remediation, blocking=True)


def _chain_current(gate_id: str, rows: list[GateResult]) -> tuple[GateResult | None, str | None]:
    """Select one contiguous owner chain without using wall-clock last-write-wins."""
    by_sequence: dict[int, list[GateResult]] = {}
    for row in rows:
        by_sequence.setdefault(row.sequence, []).append(row)
    if any(len(items) > 1 for items in by_sequence.values()):
        return None, "OWNER_CHAIN_FORK"
    ordered = [by_sequence[sequence][0] for sequence in sorted(by_sequence)]
    if not ordered:
        return None, None
    if len(ordered) == 1:
        return ordered[0], None
    if ordered[0].sequence != 1:
        return None, "OWNER_CHAIN_ROLLBACK"
    previous = ordered[0]
    if previous.predecessor_hash is not None:
        return None, "OWNER_CHAIN_ROLLBACK"
    for row in ordered[1:]:
        if row.sequence != previous.sequence + 1:
            return None, "OWNER_CHAIN_GAP"
        if row.predecessor_hash != previous.result_hash:
            return None, "OWNER_CHAIN_ROLLBACK"
        previous = row
    return previous, None


def reduce(request: ProjectionRequest, gates: tuple[GateResult, ...], requested_mode: str, now: datetime) -> EffectiveAuthorityDecision:
    _utc(now)
    definitions = applicable(request.boundary.action)
    required = tuple(item["id"] for item in definitions)
    reasons: list[ReasonProjection] = []
    coverage = "complete"
    grouped: dict[str, list[GateResult]] = {}
    for item in gates:
        definition = registry_gate(item.gate_id)
        if definition is None:
            reasons.append(_reason(item.gate_id, "UNKNOWN_GATE"))
            coverage = "partial"
        elif item.registry_version != "effective-authority-v1":
            reasons.append(_reason(item.gate_id, "WRONG_REGISTRY_VERSION"))
            coverage = "partial"
        elif item.scope != request.scope or item.boundary != request.boundary:
            reasons.append(_reason(item.gate_id, "WRONG_SCOPE"))
            coverage = "partial"
        else:
            grouped.setdefault(item.gate_id, []).append(item)

    chosen: dict[str, GateResult] = {}
    for gate_id, rows in grouped.items():
        current, chain_error = _chain_current(gate_id, rows)
        if chain_error:
            reasons.append(_reason(gate_id, chain_error))
            coverage = "conflict"
        elif current:
            chosen[gate_id] = current

    caps: list[str] = []
    expiry: list[datetime] = []
    for definition in definitions:
        gate_id = definition["id"]
        item = chosen.get(gate_id)
        if item is None:
            reasons.append(_reason(gate_id, "MISSING_REQUIRED_GATE", definition["remediation"]))
            caps.append("ANALYZE_ONLY")
            continue
        effective_expiry = min(item.expires_at, item.observed_at + timedelta(seconds=definition["freshnessSeconds"]))
        expiry.append(effective_expiry)
        if item.source.source_type != definition["sourceType"]:
            code = "WRONG_SOURCE_TYPE"
        elif item.source.source_version != definition["sourceVersion"]:
            code = "WRONG_SOURCE_VERSION"
        elif item.source.provenance != "local_fixture_untrusted":
            code = "UNTRUSTED_PROVENANCE"
        elif effective_expiry <= now or item.status == "stale":
            code = "STALE_GATE"
        elif item.status != "pass":
            code = definition["reason"]
        else:
            code = None
        if code:
            if code in {"WRONG_SOURCE_TYPE", "WRONG_SOURCE_VERSION", "UNTRUSTED_PROVENANCE"}:
                coverage = "partial"
            reasons.append(_reason(gate_id, code, definition["remediation"]))
            caps.append(definition["fallback"])
        else:
            caps.append(item.ceiling)
        if any(parent not in chosen for parent in definition["prerequisites"]):
            reasons.append(_reason(gate_id, "MISSING_PREREQUISITE", definition["remediation"]))
            caps.append(definition["fallback"])

    capability = min(caps, key=lambda value: ORDER[value]) if caps else "ANALYZE_ONLY"
    if requested_mode == "Shadow":
        capability = min((capability, "SHADOW_SIMULATE"), key=lambda value: ORDER[value])
    capability = min((capability, "PREFLIGHT_ONLY"), key=lambda value: ORDER[value])
    blocked = bool(reasons)
    phase = "EXECUTION_BLOCKED" if blocked and request.boundary.action in {"preflight", "submit"} else capability
    if requested_mode == "Approval" and not request.boundary.approval_hash and not blocked:
        capability, phase = "SHADOW_SIMULATE", "AWAITING_USER_APPROVAL"
    ordered = tuple(sorted(reasons, key=lambda item: ((registry_gate(item.gate_id) or {"rank": 999})["rank"], item.reason_code, item.gate_id)))
    body = {"scope": request.scope, "boundary": request.boundary, "requested_mode": requested_mode, "capability": capability, "phase": phase, "coverage": coverage, "reasons": ordered, "gate_hashes": tuple(sorted(item.result_hash for item in gates)), "registry_hash": registry_hash(), "created_at": now, "expires_at": min(expiry) if expiry else now, "non_authorizing": True, "product_status": "unavailable", "authority_effect": "none"}
    return EffectiveAuthorityDecision(**body, decision_hash=digest(body))


def assert_monotone(before: EffectiveAuthorityDecision, after: EffectiveAuthorityDecision) -> None:
    if ORDER[after.capability] > ORDER[before.capability]:
        raise AssertionError("authority_increase")
