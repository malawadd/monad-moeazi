"""Strict canonical primitives for the isolated analytical-diversity fixture."""
from __future__ import annotations
import hashlib, json, re, unicodedata
from datetime import datetime
HASH = re.compile(r"^[a-f0-9]{64}$")
def load(text: str):
 def pairs(values):
  out = {}
  for key, value in values:
   if key in out: raise ValueError("duplicate_json_key")
   out[key] = value
  return out
 return json.loads(text, object_pairs_hook=pairs, parse_float=lambda _: (_ for _ in ()).throw(ValueError("float")), parse_constant=lambda _: (_ for _ in ()).throw(ValueError("non_finite")))
def canonical(value):
 def walk(item, depth=0):
  if depth > 16: raise ValueError("depth")
  if item is None or type(item) in {bool, int}: return item
  if isinstance(item, float): raise ValueError("float")
  if isinstance(item, str):
   if unicodedata.normalize("NFC", item) != item or len(item) > 256 or any(ord(c) < 32 for c in item): raise ValueError("text")
   return item
  if isinstance(item, tuple): item = list(item)
  if isinstance(item, list):
   if len(item) > 512: raise ValueError("cardinality")
   return [walk(v, depth + 1) for v in item]
  if isinstance(item, dict):
   if len(item) > 128 or any(not isinstance(k, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,79}", k) for k in item): raise ValueError("key")
   return {k: walk(item[k], depth + 1) for k in sorted(item)}
  raise ValueError("type")
 return json.dumps(walk(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
def digest(value): return hashlib.sha256(canonical(value)).hexdigest()
def utc(value):
 if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value): raise ValueError("utc")
 datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ"); return value
def hash_value(value):
 if not isinstance(value, str) or not HASH.fullmatch(value): raise ValueError("hash")
 return value
