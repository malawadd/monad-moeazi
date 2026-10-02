"""Canonical, fixture-only encoding for the schedule-sync outbox."""
from __future__ import annotations
import hashlib,json,unicodedata
from datetime import datetime,timezone

def _pairs(rows):
 result={}
 for key,value in rows:
  if key in result: raise ValueError("schedule_sync_duplicate_json_key")
  result[key]=value
 return result
def _normal(value):
 if hasattr(value,"__dict__"): return {key:_normal(item) for key,item in value.__dict__.items()}
 if isinstance(value,tuple): return [_normal(item) for item in value]
 if isinstance(value,list): return [_normal(item) for item in value]
 if isinstance(value,dict): return {key:_normal(item) for key,item in value.items()}
 return value
def _check(value):
 if isinstance(value,float): raise ValueError("schedule_sync_float_forbidden")
 if isinstance(value,dict):
  for key,item in value.items():
   if not isinstance(key,str) or len(key)>96 or unicodedata.normalize("NFC",key)!=key or any(ord(c)<32 or c in "\u200b\u200c\u200d\ufeff" for c in key): raise ValueError("schedule_sync_text_invalid")
   if any(word in key.lower() for word in ("token","secret","credential","authorization","header","url")): raise ValueError("schedule_sync_secret_field")
   _check(item)
 elif isinstance(value,(list,tuple)):
  for item in value: _check(item)
 elif isinstance(value,str):
  if len(value)>256 or unicodedata.normalize("NFC",value)!=value or any(ord(c)<32 or c in "\u200b\u200c\u200d\ufeff" for c in value): raise ValueError("schedule_sync_text_invalid")
 elif not isinstance(value,(str,int,bool,type(None))): raise ValueError("schedule_sync_value_invalid")
def canonical(value):
 value=_normal(value); _check(value); raw=json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)
 return unicodedata.normalize("NFC",raw)
def digest(value): return hashlib.sha256(canonical(value).encode()).hexdigest()
def utc(value):
 if isinstance(value,datetime): parsed=value
 elif isinstance(value,str): parsed=datetime.fromisoformat(value.replace("Z","+00:00"))
 else: raise ValueError("schedule_sync_time_invalid")
 if parsed.tzinfo is None or parsed.utcoffset()!=timezone.utc.utcoffset(parsed) or parsed.microsecond: raise ValueError("schedule_sync_time_invalid")
 return parsed.astimezone(timezone.utc).isoformat().replace("+00:00","Z")
