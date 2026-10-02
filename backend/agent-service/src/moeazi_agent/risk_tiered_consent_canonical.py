"""Canonical, local-fixture-only primitives for Feature 20."""
from __future__ import annotations
import hashlib, json, re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

class CanonicalError(ValueError): pass
def _pairs(rows):
    out={}
    for key,value in rows:
        if key in out: raise CanonicalError("duplicate_json_key")
        out[key]=value
    return out
def json_loads_strict(raw:str)->Any:
    return canonical_value(json.loads(raw,object_pairs_hook=_pairs,parse_float=lambda _:(_ for _ in ()).throw(CanonicalError("float_not_allowed")),parse_constant=lambda value:(_ for _ in ()).throw(CanonicalError(f"non_finite:{value}"))))
def utc_millis(value:datetime)->str:
    if value.tzinfo is None or value.utcoffset()!=timezone.utc.utcoffset(value) or value.microsecond%1000: raise CanonicalError("utc_millisecond_timestamp_required")
    return value.isoformat(timespec="milliseconds").replace("+00:00","Z")
def canonical_value(value:Any)->Any:
    if isinstance(value,float): raise CanonicalError("float_not_allowed")
    if isinstance(value,Decimal):
        if value!=value.to_integral_value(): raise CanonicalError("decimal_string_required")
        return int(value)
    if isinstance(value,datetime): return utc_millis(value)
    if hasattr(value,"model_dump"): return canonical_value(value.model_dump(mode="python"))
    if isinstance(value,dict): return {str(k):canonical_value(v) for k,v in value.items()}
    if isinstance(value,(tuple,list)): return [canonical_value(v) for v in value]
    if value is None or isinstance(value,(str,int,bool)): return value
    raise CanonicalError(f"unsupported:{type(value).__name__}")
def canonical_json(value:Any)->str: return json.dumps(canonical_value(value),sort_keys=True,separators=(",",":"),ensure_ascii=True,allow_nan=False)
def digest(value:Any)->str: return hashlib.sha256(canonical_json(value).encode()).hexdigest()
def bounded_id(value:str,prefix:str)->str:
    if not re.fullmatch(prefix+r"[a-z0-9:_-]{1,64}",value): raise CanonicalError("invalid_bounded_id")
    return value
def decimal_string(value:str)->str:
    if not re.fullmatch(r"0|[1-9][0-9]*",value): raise CanonicalError("invalid_exact_decimal")
    return value
def sorted_unique(values:tuple[str,...])->tuple[str,...]:
    if tuple(sorted(values))!=values or len(set(values))!=len(values): raise CanonicalError("set_not_sorted_unique")
    return values
