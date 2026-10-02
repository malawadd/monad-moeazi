"""Pure integer, fail-closed policy for checked-in venue-price fixtures."""
from __future__ import annotations
from datetime import datetime, timedelta
from .venue_price_canonical import digest
from .venue_price_contracts import PriceSafetyDecision, Receipt, VenuePriceSemantics
from .venue_price_registry import raw

INCREASE = {"prepare", "open", "increase"}
KNOWN = {"anomaly_detected", "constraint_failed", "divergence_exceeded", "finality_invalid", "liquidity_insufficient", "manipulation_flag", "margin_failed"}


def ppm(left: str, right: str) -> int | None:
    """Exact divergence with no float conversion; zero denominator is unknown."""
    a, b = int(left), int(right)
    if b == 0: return None
    return abs(a - b) * 1_000_000 // abs(b)


def evaluate(scope_hash: str, operation: str, semantics: VenuePriceSemantics,
             receipts: list[Receipt], request_hash: str, idempotency_key: str,
             now: datetime, *, feature07_ok: bool, safe_lanes: list[str]) -> PriceSafetyDecision:
    registry = raw()
    reasons: set[str] = set()
    if operation not in registry["operations"]: reasons.add("unsupported_operation")
    if not feature07_ok: reasons.add("definition_drift")
    if now < semantics.valid_from or now >= semantics.valid_until: reasons.add("expired")
    for receipt in receipts:
        if receipt.scope_hash != scope_hash: reasons.add("scope_mismatch")
        if receipt.expires_at <= now: reasons.add("stale")
        if receipt.outcome == "block": reasons.update(receipt.reason_codes or ["constraint_failed"])
        if receipt.outcome == "unknown": reasons.update(receipt.reason_codes or ["missing_component"])
    known = bool(reasons & KNOWN)
    unknown = bool(reasons - KNOWN)
    lanes = sorted(set(safe_lanes) & set(registry["safeLanes"])) if operation in INCREASE else []
    if not reasons: outcome = "pass"
    elif operation in INCREASE and lanes: outcome = "close_only"
    else: outcome = "block" if known else "unknown"
    expires = min([semantics.valid_until, *(item.expires_at for item in receipts), now + timedelta(seconds=30)])
    body = {"scope_hash": scope_hash, "operation": operation, "outcome": outcome, "safe_lanes": lanes,
        "reason_codes": sorted(reasons), "receipt_hashes": sorted(item.receipt_hash for item in receipts),
        "expires_at": expires, "request_hash": request_hash, "idempotency_key": idempotency_key}
    return PriceSafetyDecision(**body, decision_hash=digest(body))
