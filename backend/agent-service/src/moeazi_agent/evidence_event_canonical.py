"""Strict canonical encoding for the local Evidence Event Fabric."""
from __future__ import annotations
import json, re, unicodedata
from datetime import datetime, timezone
from hashlib import sha256

_BAD_KEYS={"authorization","credential","header","password","secret","signature","token","url"}
_HEX=re.compile(r"^[a-f0-9]{64}$")
def _check(value):
    if isinstance(value,float): raise ValueError("evidence_float_forbidden")
    if isinstance(value,str):
        if value!=unicodedata.normalize("NFC",value) or len(value.encode())>256 or any(ord(c)<32 or 0x200b<=ord(c)<=0x200f for c in value): raise ValueError("evidence_scalar_invalid")
        if "://" in value or "<" in value or ">" in value: raise ValueError("evidence_unsafe_text")
    elif isinstance(value,datetime):
        if value.tzinfo is None or value.utcoffset()!=timezone.utc.utcoffset(value) or value.microsecond: raise ValueError("evidence_timestamp_invalid")
    elif isinstance(value,dict):
        for key,item in value.items():
            if not isinstance(key,str) or key.lower() in _BAD_KEYS: raise ValueError("evidence_field_forbidden")
            _check(item)
    elif isinstance(value,(list,tuple)):
        for item in value: _check(item)
    elif value is not None and type(value) not in (bool,int): raise ValueError("evidence_value_invalid")
def canonical_json(value):
    _check(value)
    return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,default=lambda v:v.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")).encode()
def digest(value): return sha256(value if isinstance(value,bytes) else canonical_json(value)).hexdigest()
def utc(value):
    if isinstance(value,datetime): _check(value); return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if not isinstance(value,str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ",value): raise ValueError("evidence_timestamp_invalid")
    return value
def require_hash(value):
    if not isinstance(value,str) or not _HEX.fullmatch(value): raise ValueError("evidence_hash_invalid")
    return value
