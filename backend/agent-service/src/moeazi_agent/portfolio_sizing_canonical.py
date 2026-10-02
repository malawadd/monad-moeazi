"""Float-free canonical primitives for the isolated sizing fixture plane."""
from __future__ import annotations
import hashlib, json, re, unicodedata
from datetime import datetime, timezone
_BAD=re.compile(r"(?:secret|password|credential|wallet|private|url|path|command|calldata)",re.I)
def _pairs(items):
 out={}
 for key,value in items:
  if key in out: raise ValueError("portfolio_sizing_duplicate_key")
  out[key]=value
 return out
def load(raw): return json.loads(raw,object_pairs_hook=_pairs,parse_float=lambda _:(_ for _ in ()).throw(ValueError("portfolio_sizing_float")))
def check(value,depth=0):
 if depth>12: raise ValueError("portfolio_sizing_depth")
 if value is None or isinstance(value,bool): return
 if type(value) is int:
  if abs(value)>10**18: raise ValueError("portfolio_sizing_integer")
  return
 if isinstance(value,str):
  if not value or len(value)>512 or value!=unicodedata.normalize("NFC",value) or any(ord(x)<32 for x in value): raise ValueError("portfolio_sizing_text")
  return
 if isinstance(value,(tuple,list)):
  if len(value)>512: raise ValueError("portfolio_sizing_array")
  for item in value: check(item,depth+1)
  return
 if isinstance(value,dict):
  for key,item in value.items():
   if not isinstance(key,str) or _BAD.search(key): raise ValueError("portfolio_sizing_key")
   check(item,depth+1)
  return
 raise ValueError("portfolio_sizing_type")
def canonical(value): check(value); return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)
def digest(value): return hashlib.sha256(canonical(value).encode()).hexdigest()
def utc_second(value):
 try: parsed=datetime.fromisoformat(value.replace("Z","+00:00"))
 except ValueError as exc: raise ValueError("portfolio_sizing_time") from exc
 if parsed.tzinfo!=timezone.utc or parsed.microsecond: raise ValueError("portfolio_sizing_time")
 return value
def floor_div(a,b):
 if type(a)is not int or type(b)is not int or b<=0: raise ValueError("portfolio_sizing_division")
 return a//b
def isqrt(value):
 if type(value)is not int or value<0: raise ValueError("portfolio_sizing_sqrt")
 return _binary_sqrt(value)
def _binary_sqrt(value):
 low,high=0,value
 while low+1<high:
  middle=(low+high)//2
  if middle*middle<=value: low=middle
  else: high=middle
 return low
