"""Canonical primitives for the local venue-price fixture plane."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any

from pydantic import BaseModel

HASH = re.compile(r"^[a-f0-9]{64}$")
UINT256 = 2**256 - 1


def integer(value: str, *, signed: bool = False, positive: bool = False) -> int:
    pattern = r"0|[1-9][0-9]*" if not signed else r"0|-?[1-9][0-9]*"
    if type(value) is not str or not re.fullmatch(pattern, value):
        raise ValueError("quantity must be a canonical integer string")
    parsed = int(value)
    if abs(parsed) > UINT256 or (positive and parsed <= 0):
        raise ValueError("quantity outside exact bounds")
    return parsed


def normal(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
            raise ValueError("timestamps must be UTC")
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, BaseModel):
        return normal(value.model_dump(mode="python", exclude_none=False))
    if isinstance(value, dict):
        if any(type(key) is not str for key in value):
            raise ValueError("canonical keys must be strings")
        return {key: normal(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [normal(item) for item in value]
    if isinstance(value, float):
        raise ValueError("floats are prohibited")
    return value


def canonical_json(value: Any) -> bytes:
    return json.dumps(normal(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(value: Any) -> str:
    return sha256(canonical_json(value)).hexdigest()


def strict_loads(raw: str) -> Any:
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs,
        parse_float=lambda _: (_ for _ in ()).throw(ValueError("float prohibited")))
