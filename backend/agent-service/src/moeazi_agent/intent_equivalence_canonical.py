"""Canonical primitives for the isolated intent-equivalence fixture plane."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any

from pydantic import BaseModel

HASH = re.compile(r"^[a-f0-9]{64}$")
HEX = re.compile(r"^0x(?:[a-f0-9]{2})*$")
UINT256 = 2**256 - 1
UINT64 = 2**64 - 1


def exact_uint(value: str, *, positive: bool = False, bits: int = 256) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"0|[1-9][0-9]*", value):
        raise ValueError("quantities must be canonical base-10 strings")
    parsed = int(value)
    if parsed > (UINT256 if bits == 256 else UINT64) or (positive and not parsed):
        raise ValueError("quantity is outside exact bounds")
    return parsed


def normal(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
            raise ValueError("timestamps must be UTC")
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, BaseModel): return normal(value.model_dump(mode="python", exclude_none=False))
    if isinstance(value, dict):
        if any(type(key) is not str for key in value): raise ValueError("canonical keys must be strings")
        return {key: normal(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)): return [normal(item) for item in value]
    if isinstance(value, float): raise ValueError("floats are prohibited")
    return value


def canonical_json(value: Any) -> bytes:
    return json.dumps(normal(value), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def digest(value: Any) -> str: return sha256(canonical_json(value)).hexdigest()


def json_loads_strict(raw: str) -> Any:
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result: raise ValueError("duplicate JSON key")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_float=lambda _: (_ for _ in ()).throw(ValueError("float prohibited")))


def strict_hex(value: str, maximum_bytes: int = 16384) -> bytes:
    if not isinstance(value, str) or not HEX.fullmatch(value) or len(value) // 2 - 1 > maximum_bytes:
        raise ValueError("invalid inert fixture hex")
    return bytes.fromhex(value[2:])
