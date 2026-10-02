"""Canonical, bounded encoders used only for local virtual bytes."""
from __future__ import annotations
import csv,io,json,re,unicodedata
from datetime import datetime,timezone
from hashlib import sha256
FORBIDDEN=("secret","credential","password","key","signature","authorization","token","header","reasoning","body","text","identity")
PATH=re.compile(r"^[a-z0-9][a-z0-9.-]*(/[a-z0-9][a-z0-9.-]*)*$")
def digest(value): return sha256(value if isinstance(value,bytes) else canonical_json(value)).hexdigest()
def _validate(v):
 if isinstance(v,float): raise ValueError("portability_float_forbidden")
 if isinstance(v,str):
  if unicodedata.normalize("NFC",v)!=v or any(ord(c)<32 for c in v) or len(v.encode())>256: raise ValueError("portability_scalar_invalid")
 elif isinstance(v,datetime):
  if v.tzinfo is None or v.utcoffset()!=timezone.utc.utcoffset(v) or v.microsecond: raise ValueError("portability_timestamp_invalid")
 elif isinstance(v,dict):
  for k,x in v.items():
   if not isinstance(k,str) or k.lower() in FORBIDDEN: raise ValueError("portability_field_forbidden")
   _validate(x)
 elif isinstance(v,(list,tuple)):
  for x in v:_validate(x)
 elif v is not None and type(v) not in (bool,int): raise ValueError("portability_value_invalid")
def canonical_json(value):
 _validate(value)
 def default(v):
  if isinstance(v,datetime): return v.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
  raise TypeError
 return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,default=default).encode("utf-8")
def canonical_csv(columns,records):
 if not columns or len(set(columns))!=len(columns): raise ValueError("portability_csv_columns_invalid")
 ordered=sorted(records,key=lambda r:(r["domain_id"],r["record_id"],r["revision"]))
 if list(records)!=ordered: raise ValueError("portability_records_unsorted")
 out=io.StringIO(newline=""); writer=csv.writer(out,lineterminator="\n") ; writer.writerow(columns)
 for row in ordered:
  if set(row)!=set(columns): raise ValueError("portability_csv_schema_invalid")
  values=[]
  for key in columns:
   v=row[key]; _validate(v); v="" if v is None else str(v)
   if v[:1] in "=+-@": raise ValueError("portability_csv_formula")
   values.append(v)
  writer.writerow(values)
 return out.getvalue().encode("utf-8")
def normalize_path(path,registered=None):
 if not isinstance(path,str) or path!=path.strip() or "\\" in path or "%" in path or not PATH.fullmatch(path) or "//" in path or any(x in {".",".."} for x in path.split("/")): raise ValueError("portability_path_invalid")
 if registered is not None and path not in registered: raise ValueError("portability_path_unregistered")
 return path
