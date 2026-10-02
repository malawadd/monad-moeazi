"""Strict local translations for control-plane fixture receipts only."""
from __future__ import annotations

from typing import Mapping

_STATUSES = {"pass", "fail", "unknown", "stale", "not_applicable"}
_CONTROL_SOURCES = {"deployment": "deployment", "customer_mode": "mode", "manual_guard": "safeguard"}


def _valid_hash(value: object) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def consume_control_gate(value: Mapping[str, object], gate_id: str, scope_hash: str) -> tuple[str, str]:
    expected = {"gateId", "sourceType", "sourceVersion", "scopeHash", "receiptHash", "status", "safeCode"}
    if set(value) != expected or _CONTROL_SOURCES.get(gate_id) != value.get("sourceType"):
        return "unknown", "CONTROL_CONTRACT_MISMATCH"
    if value.get("sourceVersion") != "fixture-v1" or value.get("scopeHash") != scope_hash:
        return "unknown", "CONTROL_SCOPE_OR_VERSION_MISMATCH"
    if value.get("gateId") != gate_id or not _valid_hash(value.get("receiptHash")):
        return "unknown", "CONTROL_IDENTITY_MISMATCH"
    return (str(value["status"]), str(value["safeCode"])) if value.get("status") in _STATUSES else ("unknown", "CONTROL_STATUS_INVALID")


def consume_owner_outcome(value: Mapping[str, object]) -> tuple[str, str]:
    """Compatibility boundary for the original compact fixture shape."""
    if set(value) != {"status", "safeCode", "sourceHash", "version"} or value.get("version") != "fixture-v1" or not _valid_hash(value.get("sourceHash")):
        return "unknown", "OWNER_CONTRACT_MISMATCH"
    return (str(value["status"]), str(value["safeCode"])) if value.get("status") in _STATUSES else ("unknown", "OWNER_STATUS_INVALID")
