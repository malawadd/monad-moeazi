"""Canonical, fail-closed primitives for the local mandate-policy fixture."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any


class CanonicalError(ValueError):
    pass


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise CanonicalError(f"duplicate_json_key:{key}")
        result[key] = value
    return result


def _constant(value: str) -> Any:
    raise CanonicalError(f"non_finite_number:{value}")


def json_loads_strict(raw: str) -> Any:
    """Reject duplicate keys, floats and non-finite numeric constants."""
    value = json.loads(raw, object_pairs_hook=_pairs, parse_float=lambda _: _float(),
                       parse_constant=_constant)
    return validate_canonical_value(value)


def _float() -> Any:
    raise CanonicalError("float_not_allowed")


def utc_millis(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
        raise CanonicalError("utc_timestamp_required")
    if value.microsecond % 1000:
        raise CanonicalError("millisecond_timestamp_required")
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def validate_canonical_value(value: Any) -> Any:
    if isinstance(value, float):
        raise CanonicalError("float_not_allowed")
    if isinstance(value, Decimal):
        if value != value.to_integral_value():
            raise CanonicalError("non_integer_decimal")
        return int(value)
    if isinstance(value, datetime):
        return utc_millis(value)
    if hasattr(value, "model_dump"):
        return validate_canonical_value(value.model_dump(mode="python"))
    if isinstance(value, dict):
        return {str(k): validate_canonical_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [validate_canonical_value(v) for v in value]
    if value is None or isinstance(value, (str, int, bool)):
        return value
    raise CanonicalError(f"unsupported_canonical_type:{type(value).__name__}")


def canonical_json(value: Any) -> str:
    return json.dumps(validate_canonical_value(value), sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False)


def digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
