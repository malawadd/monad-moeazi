"""Strict execution-boundary fixture translations with no execution imports."""
from __future__ import annotations

from typing import Mapping

_STATUSES = {"pass", "fail", "unknown", "stale", "not_applicable"}
_RECEIPTS = {"certification", "risk", "reservation", "attempt", "reconciliation", "journal", "intent", "venue", "collateral", "termination", "capability", "instrument", "temporal"}


def _hash(value: object) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def consume_execution_gate(value: Mapping[str, object], receipt_type: str, scope_hash: str) -> tuple[str, str]:
    expected = {"receiptType", "receiptVersion", "scopeHash", "receiptHash", "status", "safeCode"}
    if set(value) != expected or receipt_type not in _RECEIPTS or value.get("receiptType") != receipt_type:
        return "unknown", "EXECUTION_CONTRACT_MISMATCH"
    if value.get("receiptVersion") != "fixture-v1" or value.get("scopeHash") != scope_hash:
        return "unknown", "EXECUTION_SCOPE_OR_VERSION_MISMATCH"
    if not _hash(value.get("receiptHash")):
        return "unknown", "EXECUTION_HASH_MISMATCH"
    return (str(value["status"]), str(value["safeCode"])) if value.get("status") in _STATUSES else ("unknown", "EXECUTION_STATUS_INVALID")


def consume_execution_outcome(value: Mapping[str, object]) -> tuple[str, str]:
    receipt_type = str(value.get("receiptType", ""))
    return consume_execution_gate(value, receipt_type, str(value.get("scopeHash", "")))
