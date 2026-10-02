"""Canonical, float-free primitives for the isolated decision-memory corpus."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any

HASH = re.compile(r"^[a-f0-9]{64}$")
IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9-]{2,79}$")


def _pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in items:
        if key in result:
            raise ValueError("decision_memory_duplicate_key")
        result[key] = value
    return result


def load(raw: str) -> Any:
    return json.loads(raw, object_pairs_hook=_pairs,
        parse_float=lambda _: (_ for _ in ()).throw(ValueError("decision_memory_float")))


def check(value: Any, depth: int = 0) -> None:
    if depth > 12:
        raise ValueError("decision_memory_depth")
    if value is None or type(value) is bool:
        return
    if type(value) is int:
        if abs(value) > 10**18:
            raise ValueError("decision_memory_integer")
        return
    if isinstance(value, str):
        if (not value or len(value) > 1024 or value != unicodedata.normalize("NFC", value)
                or any(ord(char) < 32 for char in value)):
            raise ValueError("decision_memory_text")
        return
    if isinstance(value, (tuple, list)):
        if len(value) > 512:
            raise ValueError("decision_memory_cardinality")
        for item in value:
            check(item, depth + 1)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or key in {"secret", "wallet", "credential", "url", "signature"}:
                raise ValueError("decision_memory_key")
            check(item, depth + 1)
        return
    raise ValueError("decision_memory_type")


def canonical(value: Any) -> str:
    check(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def utc(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("decision_memory_time") from exc
    if parsed.tzinfo != timezone.utc or parsed.microsecond or value != parsed.strftime("%Y-%m-%dT%H:%M:%SZ"):
        raise ValueError("decision_memory_time")
    return value


def require_hash(value: str) -> str:
    if not HASH.fullmatch(value):
        raise ValueError("decision_memory_hash")
    return value


def require_id(value: str) -> str:
    if not IDENTIFIER.fullmatch(value):
        raise ValueError("decision_memory_identifier")
    return value
