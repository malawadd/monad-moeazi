"""Canonical, float-free primitives for the isolated Feature 34 corpus."""
from __future__ import annotations
import hashlib,json,unicodedata
from datetime import datetime,timezone
def _pairs(items):
 out={}
 for key,value in items:
  if key in out: raise ValueError("run_planning_duplicate_key")
  out[key]=value
 return out
def load(raw): return json.loads(raw,object_pairs_hook=_pairs,parse_float=lambda _:(_ for _ in ()).throw(ValueError("run_planning_float")))
def check(value,depth=0):
 if depth>12: raise ValueError("run_planning_depth")
 if value is None or isinstance(value,bool): return
 if type(value) is int:
  if abs(value)>10**18: raise ValueError("run_planning_integer")
  return
 if isinstance(value,str):
  if not value or len(value)>512 or value!=unicodedata.normalize("NFC",value) or any(ord(c)<32 for c in value): raise ValueError("run_planning_text")
  return
 if isinstance(value,(tuple,list)):
  if len(value)>512: raise ValueError("run_planning_cardinality")
  for item in value: check(item,depth+1)
  return
 if isinstance(value,dict):
  for key,item in value.items():
   if not isinstance(key,str) or key in {"secret","wallet","credential","url","path","signature"}: raise ValueError("run_planning_key")
   check(item,depth+1)
  return
 raise ValueError("run_planning_type")
def canonical(value): check(value); return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)
def digest(value): return hashlib.sha256(canonical(value).encode()).hexdigest()
def utc(value):
 try: parsed=datetime.fromisoformat(value.replace("Z","+00:00"))
 except ValueError as exc: raise ValueError("run_planning_time") from exc
 if parsed.tzinfo!=timezone.utc or parsed.microsecond: raise ValueError("run_planning_time")
 return value
