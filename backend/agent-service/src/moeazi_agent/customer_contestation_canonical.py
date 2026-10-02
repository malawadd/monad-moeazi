"""Canonical primitives for the local, synthetic contestation fixture only."""
from __future__ import annotations
import hashlib, json, unicodedata
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

class CanonicalError(ValueError): pass
_BANNED=("email","address","name","token","signature","url","command","body","file","credential","text")
def _pairs(rows):
    out={}
    for key,value in rows:
        if key in out: raise CanonicalError("duplicate_json_key")
        out[key]=value
    return out
def _float(_: str): raise CanonicalError("float_not_allowed")
def _constant(_: str): raise CanonicalError("non_finite_number")
def utc_second(value: datetime)->str:
    if value.tzinfo is None or value.utcoffset()!=timezone.utc.utcoffset(value) or value.microsecond: raise CanonicalError("utc_second_required")
    return value.isoformat().replace("+00:00","Z")
def validate(value: Any)->Any:
    if isinstance(value,float): raise CanonicalError("float_not_allowed")
    if isinstance(value,Decimal):
        if value!=value.to_integral_value(): raise CanonicalError("non_integer_decimal")
        return int(value)
    if isinstance(value,datetime): return utc_second(value)
    if hasattr(value,"model_dump"): return validate(value.model_dump(mode="python"))
    if isinstance(value,dict):
        if any(k.lower() in _BANNED for k in value): raise CanonicalError("sensitive_field_forbidden")
        return {str(k):validate(v) for k,v in value.items()}
    if isinstance(value,(tuple,list)): return [validate(v) for v in value]
    if value is None or isinstance(value,(bool,int)): return value
    if isinstance(value,str):
        if len(value)>256 or any(ord(c)<32 for c in value) or unicodedata.normalize("NFC",value)!=value: raise CanonicalError("invalid_canonical_string")
        return value
    raise CanonicalError("unsupported_canonical_type")
def json_loads_strict(raw:str)->Any: return validate(json.loads(raw,object_pairs_hook=_pairs,parse_float=_float,parse_constant=_constant))
def canonical_json(value:Any)->str: return json.dumps(validate(value),sort_keys=True,separators=(",",":"),ensure_ascii=True,allow_nan=False)
def digest(value:Any)->str: return hashlib.sha256(canonical_json(value).encode()).hexdigest()
