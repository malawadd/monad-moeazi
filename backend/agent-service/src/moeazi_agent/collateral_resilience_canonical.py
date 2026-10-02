"""Canonical, local-only bytes for collateral-resilience fixture receipts."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any

HASH = re.compile(r"^[a-f0-9]{64}$")
INTEGER = re.compile(r"^(0|[1-9][0-9]*)$")
SIGNED_INTEGER = re.compile(r"^(0|-[1-9][0-9]*|[1-9][0-9]*)$")


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def strict_loads(text: str) -> Any:
    return json.loads(text, object_pairs_hook=_pairs, parse_float=lambda _: (_ for _ in ()).throw(ValueError("floats forbidden")))


def normal(value: Any) -> Any:
    # Booleans are permitted only in explicit boolean fields; Pydantic's strict
    # integer fields reject them before arithmetic. Floats never have a role here.
    if isinstance(value, float):
        raise ValueError("floats forbidden")
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None or value.utcoffset().total_seconds() != 0:
            raise ValueError("UTC time required")
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, dict):
        return {key: normal(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple)):
        return [normal(item) for item in value]
    return value


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(normal(value), sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")).hexdigest()


def integer(value: str, *, signed: bool = False) -> int:
    if not isinstance(value, str) or not (SIGNED_INTEGER if signed else INTEGER).fullmatch(value):
        raise ValueError("noncanonical integer")
    parsed = int(value)
    if abs(parsed) > 2**255 - 1:
        raise ValueError("integer out of range")
    return parsed
