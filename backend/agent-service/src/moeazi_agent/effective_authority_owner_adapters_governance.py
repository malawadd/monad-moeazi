"""Strict governance fixture translations; local provenance can never grant trust."""
from __future__ import annotations

from typing import Mapping

_STATUSES = {"pass", "fail", "unknown", "stale", "not_applicable"}
_RECEIPTS = {"policy", "quorum", "qualification", "mandate"}


def _hash(value: object) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def consume_governance_gate(value: Mapping[str, object], receipt_type: str, scope_hash: str) -> tuple[str, str]:
    expected = {"receiptType", "receiptVersion", "scopeHash", "receiptHash", "status", "safeCode", "provenance"}
    if set(value) != expected or receipt_type not in _RECEIPTS or value.get("receiptType") != receipt_type:
        return "unknown", "GOVERNANCE_CONTRACT_MISMATCH"
    if value.get("receiptVersion") != "fixture-v1" or value.get("scopeHash") != scope_hash or not _hash(value.get("receiptHash")):
        return "unknown", "GOVERNANCE_SCOPE_OR_VERSION_MISMATCH"
    if value.get("provenance") != "local_fixture_untrusted":
        return "unknown", "GOVERNANCE_PROVENANCE_UNTRUSTED"
    return (str(value["status"]), str(value["safeCode"])) if value.get("status") in _STATUSES else ("unknown", "GOVERNANCE_STATUS_INVALID")


def consume_governance_outcome(value: Mapping[str, object]) -> tuple[str, str]:
    legacy = {"receiptType", "receiptVersion", "scopeHash", "receiptHash", "status", "safeCode"}
    if set(value) != legacy:
        return "unknown", "GOVERNANCE_CONTRACT_MISMATCH"
    augmented = {**value, "provenance": "local_fixture_untrusted"}
    return consume_governance_gate(augmented, str(value.get("receiptType", "")), str(value.get("scopeHash", "")))
