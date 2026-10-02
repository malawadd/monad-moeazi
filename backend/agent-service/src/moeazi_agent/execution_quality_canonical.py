"""Canonical, bounded primitives for isolated execution-quality fixtures."""
from __future__ import annotations
import hashlib,json,re,unicodedata
from datetime import datetime,timezone
_BAD=re.compile(r"(?:secret|password|credential|wallet|private|url|path|command|calldata|endpoint|nonce|signature)",re.I)
def _pairs(items):
 out={}
 for key,value in items:
  if key in out: raise ValueError("execution_quality_duplicate_key")
  out[key]=value
 return out
def load(raw): return json.loads(raw,object_pairs_hook=_pairs,parse_float=lambda _:(_ for _ in ()).throw(ValueError("execution_quality_float")))
def check(value,depth=0):
 if depth>12: raise ValueError("execution_quality_depth")
 if value is None or isinstance(value,bool): return
 if type(value) is int:
  if abs(value)>10**18: raise ValueError("execution_quality_integer")
  return
 if isinstance(value,str):
  if not value or len(value)>512 or value!=unicodedata.normalize("NFC",value) or any(ord(x)<32 for x in value): raise ValueError("execution_quality_text")
  return
 if isinstance(value,(tuple,list)):
  if len(value)>512: raise ValueError("execution_quality_array")
  for item in value: check(item,depth+1)
  return
 if isinstance(value,dict):
  for key,item in value.items():
   if not isinstance(key,str) or _BAD.search(key): raise ValueError("execution_quality_key")
   check(item,depth+1)
  return
 raise ValueError("execution_quality_type")
def canonical(value): check(value); return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)
def digest(value): return hashlib.sha256(canonical(value).encode()).hexdigest()
def utc_second(value):
 try: parsed=datetime.fromisoformat(value.replace("Z","+00:00"))
 except ValueError as exc: raise ValueError("execution_quality_time") from exc
 if parsed.tzinfo!=timezone.utc or parsed.microsecond: raise ValueError("execution_quality_time")
 return value
def ceil_div(a,b):
 if type(a)is not int or type(b)is not int or b<=0: raise ValueError("execution_quality_division")
 return -(-a//b)
def atoms(decimal,scale):
 if not isinstance(decimal,str) or not decimal or type(scale)is not int or not 0<=scale<=12: raise ValueError("execution_quality_decimal")
 sign=-1 if decimal.startswith("-") else 1; value=decimal[1:] if sign<0 else decimal
 if value.count(".")>1 or not value.replace(".","").isdigit(): raise ValueError("execution_quality_decimal")
 whole,_,fraction=value.partition(".")
 if len(fraction)>scale: raise ValueError("execution_quality_precision")
 return sign*(int(whole)*10**scale+int((fraction+"0"*scale)[:scale] or 0))
