"""Strict, fixture-only canonical encoding for the local assurance corpus."""
from __future__ import annotations
import hashlib,json,unicodedata
from datetime import datetime,timezone
_BAD={"token","secret","credential","authorization","password","header","url","path"}
def _plain(v):
 if hasattr(v,"model_dump"): return _plain(v.model_dump(mode="json"))
 if hasattr(v,"__dict__"): return _plain(v.__dict__)
 if isinstance(v,tuple): return [_plain(x) for x in v]
 if isinstance(v,list): return [_plain(x) for x in v]
 if isinstance(v,dict): return {k:_plain(x) for k,x in v.items()}
 return v
def _check(v):
 if isinstance(v,float) or isinstance(v,bool) and type(v) is not bool: raise ValueError("assurance_value_invalid")
 if isinstance(v,datetime):
  if v.tzinfo is None or v.utcoffset()!=timezone.utc.utcoffset(v) or v.microsecond: raise ValueError("assurance_time_invalid")
 elif isinstance(v,dict):
  if len(v)>96: raise ValueError("assurance_bound_invalid")
  for k,x in v.items():
   if not isinstance(k,str) or len(k)>96 or k.lower() in _BAD or any(ord(c)<32 or c in "\u200b\u200c\u200d\ufeff" for c in k): raise ValueError("assurance_field_invalid")
   _check(x)
 elif isinstance(v,(list,tuple)):
  if len(v)>256: raise ValueError("assurance_bound_invalid")
  for x in v:_check(x)
 elif isinstance(v,str):
  if len(v)>512 or v!=unicodedata.normalize("NFC",v) or any(ord(c)<32 or c in "\u200b\u200c\u200d\ufeff" for c in v): raise ValueError("assurance_text_invalid")
 elif v is not None and type(v) not in (int,bool): raise ValueError("assurance_value_invalid")
def canonical(v):
 v=_plain(v); _check(v)
 return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False,default=lambda x:x.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
def digest(v): return hashlib.sha256(canonical(v).encode()).hexdigest()
def utc(v):
 if isinstance(v,datetime): _check(v); return v.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
 if not isinstance(v,str) or len(v)!=20 or not v.endswith("Z"): raise ValueError("assurance_time_invalid")
 return v
