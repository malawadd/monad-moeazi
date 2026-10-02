"""Canonical, bounded values for the fixture-only claim ledger."""
from __future__ import annotations
import hashlib,json,re,unicodedata
from datetime import datetime,timezone
_SECRET=re.compile(r"^(secret|password|credential|wallet|private|url|path)$",re.I)
def _pairs(pairs):
 d={}
 for k,v in pairs:
  if k in d: raise ValueError("ledger_duplicate_key")
  d[k]=v
 return d
def load(raw:str): return json.loads(raw,object_pairs_hook=_pairs,parse_float=lambda _:(_ for _ in ()).throw(ValueError("ledger_float")))
def check(value,depth=0):
 if depth>8: raise ValueError("ledger_depth")
 if isinstance(value,bool) or value is None: return
 if isinstance(value,int):
  if abs(value)>10**12: raise ValueError("ledger_integer")
  return
 if isinstance(value,str):
  if len(value)>512 or value!=unicodedata.normalize("NFC",value) or any(ord(x)<32 or ord(x) in {0x200b,0x200c,0x200d} for x in value): raise ValueError("ledger_text")
  return
 if isinstance(value,(list,tuple)):
  if len(value)>128: raise ValueError("ledger_array")
  for x in value: check(x,depth+1)
  return
 if isinstance(value,dict):
  for k,v in value.items():
   if not isinstance(k,str) or _SECRET.search(k): raise ValueError("ledger_key")
   check(v,depth+1)
  return
 raise ValueError("ledger_type")
def canonical(value):
 check(value); return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)
def digest(value): return hashlib.sha256(canonical(value).encode()).hexdigest()
def utc_second(value:str):
 try: parsed=datetime.fromisoformat(value.replace("Z","+00:00"))
 except ValueError as exc: raise ValueError("ledger_time") from exc
 if parsed.tzinfo!=timezone.utc or parsed.microsecond: raise ValueError("ledger_time")
 return value
