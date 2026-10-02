"""Canonical, bounded primitives for the isolated termination fixture plane."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any

from pydantic import BaseModel

HASH = re.compile(r"^[a-f0-9]{64}$")
ID = re.compile(r"^[a-z][a-z0-9:_-]{2,100}$")


def canonical_time(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
        raise ValueError("timestamps must be UTC")
    rendered = value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if not rendered.endswith("Z"):
        raise ValueError("timestamp is not canonical")
    return rendered


def normal(value: Any) -> Any:
    if isinstance(value, datetime): return canonical_time(value)
    if isinstance(value, BaseModel): return normal(value.model_dump(mode="python", exclude_none=False))
    if isinstance(value, dict):
        if any(type(key) is not str for key in value): raise ValueError("canonical keys must be strings")
        return {key: normal(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)): return [normal(item) for item in value]
    if isinstance(value, float): raise ValueError("floats are prohibited")
    if value is not None and type(value) not in (str, int, bool):
        raise ValueError("unsupported canonical value")
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
    return json.loads(raw, object_pairs_hook=pairs,
        parse_float=lambda _: (_ for _ in ()).throw(ValueError("floats are prohibited")))


def exact_integer(value: str, *, signed: bool = False) -> int:
    pattern = r"(?:0|-?[1-9][0-9]*)" if signed else r"(?:0|[1-9][0-9]*)"
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError("integer must be canonical base-10")
    return int(value)
