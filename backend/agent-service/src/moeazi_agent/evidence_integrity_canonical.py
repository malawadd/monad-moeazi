"""Canonical primitives for the isolated evidence-integrity fixture plane."""
from __future__ import annotations
import hashlib,json,re,unicodedata
from datetime import datetime,timezone

_BAD_KEY=re.compile(r"(?:secret|password|credential|wallet|private|url|path|command)",re.I)
def _pairs(values):
 out={}
 for key,value in values:
  if key in out: raise ValueError("evidence_integrity_duplicate_key")
  out[key]=value
 return out
def load(raw:str):
 return json.loads(raw,object_pairs_hook=_pairs,parse_float=lambda _:(_ for _ in ()).throw(ValueError("evidence_integrity_float")))
def check(value,depth=0):
 if depth>12: raise ValueError("evidence_integrity_depth")
 if value is None or isinstance(value,bool): return
 if type(value) is int:
  if abs(value)>10**15: raise ValueError("evidence_integrity_integer")
  return
 if isinstance(value,str):
  if not value or len(value)>512 or value!=unicodedata.normalize("NFC",value) or any(ord(x)<32 or ord(x) in {0x200b,0x200c,0x200d} for x in value): raise ValueError("evidence_integrity_text")
  return
 if isinstance(value,(tuple,list)):
  if len(value)>512: raise ValueError("evidence_integrity_array")
  for item in value: check(item,depth+1)
  return
 if isinstance(value,dict):
  for key,item in value.items():
   if not isinstance(key,str) or _BAD_KEY.search(key): raise ValueError("evidence_integrity_key")
   check(item,depth+1)
  return
 raise ValueError("evidence_integrity_type")
def canonical(value): check(value); return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)
def digest(value): return hashlib.sha256(canonical(value).encode()).hexdigest()
def utc_second(value):
 try: parsed=datetime.fromisoformat(value.replace("Z","+00:00"))
 except ValueError as exc: raise ValueError("evidence_integrity_time") from exc
 if parsed.tzinfo!=timezone.utc or parsed.microsecond: raise ValueError("evidence_integrity_time")
 return value
