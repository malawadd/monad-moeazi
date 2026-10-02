"""Canonical, bounded values for fixture-only source-value research."""
from __future__ import annotations
import hashlib,json,re,unicodedata
from datetime import datetime,timezone
_BAD=re.compile(r"(?:secret|password|credential|wallet|private|url|path)",re.I)
def _pairs(pairs):
 out={}
 for key,value in pairs:
  if key in out: raise ValueError("source_value_duplicate_key")
  out[key]=value
 return out
def load(raw): return json.loads(raw,object_pairs_hook=_pairs,parse_float=lambda _:(_ for _ in ()).throw(ValueError("source_value_float")))
def check(value,depth=0):
 if depth>10: raise ValueError("source_value_depth")
 if value is None or isinstance(value,bool): return
 if isinstance(value,int):
  if abs(value)>10**15: raise ValueError("source_value_integer")
  return
 if isinstance(value,str):
  if not value or len(value)>512 or value!=unicodedata.normalize("NFC",value) or any(ord(x)<32 or ord(x) in {0x200b,0x200c,0x200d} for x in value): raise ValueError("source_value_text")
  return
 if isinstance(value,(list,tuple)):
  if len(value)>512: raise ValueError("source_value_array")
  for item in value: check(item,depth+1)
  return
 if isinstance(value,dict):
  for key,item in value.items():
   if not isinstance(key,str) or _BAD.search(key): raise ValueError("source_value_key")
   check(item,depth+1)
  return
 raise ValueError("source_value_type")
def canonical(value): check(value); return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)
def digest(value): return hashlib.sha256(canonical(value).encode()).hexdigest()
def utc_second(value):
 try: parsed=datetime.fromisoformat(value.replace("Z","+00:00"))
 except ValueError as exc: raise ValueError("source_value_time") from exc
 if parsed.tzinfo!=timezone.utc or parsed.microsecond: raise ValueError("source_value_time")
 return value
