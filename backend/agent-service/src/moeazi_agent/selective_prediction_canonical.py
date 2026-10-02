"""Canonical, integer-only primitives for the isolated Feature 37 fixture."""
from __future__ import annotations
import hashlib
import json
import re
import unicodedata
from datetime import datetime

HASH = re.compile(r"^[a-f0-9]{64}$")

def _constant(value: str): raise ValueError(f"non_finite:{value}")

def load(text: str):
    def pairs(values):
        output = {}
        for key, value in values:
            if key in output: raise ValueError("duplicate_json_key")
            output[key] = value
        return output
    value = json.loads(text, object_pairs_hook=pairs,
        parse_float=lambda _: (_ for _ in ()).throw(ValueError("float")), parse_constant=_constant)
    if not isinstance(value, (dict, list)): raise ValueError("json_root")
    return value

def canonical(value) -> bytes:
    def walk(item, depth=0):
        if depth > 16: raise ValueError("depth")
        if item is None or type(item) in {bool, int}: return item
        if isinstance(item, float): raise ValueError("float")
        if isinstance(item, str):
            if unicodedata.normalize("NFC", item) != item or len(item) > 256 or any(ord(x) < 32 for x in item): raise ValueError("text")
            return item
        if isinstance(item, tuple): item = list(item)
        if isinstance(item, list):
            if len(item) > 512: raise ValueError("cardinality")
            return [walk(x, depth + 1) for x in item]
        if isinstance(item, dict):
            if len(item) > 128 or any(not isinstance(key, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,79}", key) for key in item): raise ValueError("key")
            return {key: walk(item[key], depth + 1) for key in sorted(item)}
        raise ValueError("type")
    return json.dumps(walk(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()

def digest(value) -> str: return hashlib.sha256(canonical(value)).hexdigest()
def utc(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value): raise ValueError("utc")
    datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ"); return value
def hash_value(value: str) -> str:
    if not isinstance(value, str) or not HASH.fullmatch(value): raise ValueError("hash")
    return value
