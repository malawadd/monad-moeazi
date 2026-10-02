"""Strict canonical primitives for the local-only authority fixture."""
from __future__ import annotations
import hashlib, json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

class CanonicalError(ValueError): pass

def _pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in items:
        if key in out: raise CanonicalError(f"duplicate_json_key:{key}")
        out[key] = value
    return out

def _float() -> None: raise CanonicalError("float_not_allowed")
def _constant(value: str) -> None: raise CanonicalError(f"non_finite_number:{value}")
def json_loads_strict(raw: str) -> Any:
    return canonical_value(json.loads(raw, object_pairs_hook=_pairs, parse_float=lambda _: _float(), parse_constant=_constant))

def utc_millis(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value) or value.microsecond % 1000:
        raise CanonicalError("utc_millisecond_timestamp_required")
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")

def canonical_value(value: Any) -> Any:
    if isinstance(value, float): raise CanonicalError("float_not_allowed")
    if isinstance(value, Decimal):
        if value != value.to_integral_value(): raise CanonicalError("decimal_string_required")
        return int(value)
    if isinstance(value, datetime): return utc_millis(value)
    if hasattr(value, "model_dump"): return canonical_value(value.model_dump(mode="python"))
    if isinstance(value, dict): return {str(k): canonical_value(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)): return [canonical_value(v) for v in value]
    if value is None or isinstance(value, (str, int, bool)): return value
    raise CanonicalError(f"unsupported_canonical_type:{type(value).__name__}")

def canonical_json(value: Any) -> str:
    return json.dumps(canonical_value(value), sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
def digest(value: Any) -> str: return hashlib.sha256(canonical_json(value).encode()).hexdigest()
def hash_is_valid(value: str) -> bool:
    return len(value) == 64 and all(ch in "0123456789abcdef" for ch in value)
