"""Canonical primitives for the isolated Product Eligibility fixture."""
from __future__ import annotations
import hashlib, json, unicodedata
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

class CanonicalError(ValueError): pass
def _pairs(rows):
    out = {}
    for key, value in rows:
        if key in out: raise CanonicalError("duplicate_json_key")
        out[key] = value
    return out
def _float(_: str): raise CanonicalError("float_not_allowed")
def _constant(_: str): raise CanonicalError("non_finite_number")
def utc_millis(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value): raise CanonicalError("utc_timestamp_required")
    if value.microsecond % 1000: raise CanonicalError("millisecond_timestamp_required")
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")
def validate(value: Any) -> Any:
    if isinstance(value, float): raise CanonicalError("float_not_allowed")
    if isinstance(value, Decimal):
        if value != value.to_integral_value(): raise CanonicalError("non_integer_decimal")
        return int(value)
    if isinstance(value, datetime): return utc_millis(value)
    if hasattr(value, "model_dump"): return validate(value.model_dump(mode="python"))
    if isinstance(value, dict): return {str(k): validate(v) for k,v in value.items()}
    if isinstance(value, (tuple,list)): return [validate(v) for v in value]
    if value is None or isinstance(value, (bool,int)): return value
    if isinstance(value,str):
        if any(ord(c)<32 for c in value): raise CanonicalError("control_character")
        if unicodedata.normalize("NFC",value)!=value: raise CanonicalError("non_nfc_string")
        return value
    raise CanonicalError("unsupported_canonical_type")
def json_loads_strict(raw: str) -> Any: return validate(json.loads(raw,object_pairs_hook=_pairs,parse_float=_float,parse_constant=_constant))
def canonical_json(value: Any) -> str: return json.dumps(validate(value),sort_keys=True,separators=(",",":"),ensure_ascii=True,allow_nan=False)
def digest(value: Any) -> str: return hashlib.sha256(canonical_json(value).encode()).hexdigest()
