"""In-memory serializer; returned buffers must be cleared by the evaluator."""
from __future__ import annotations
from .portability_canonical import canonical_json,canonical_csv,digest,normalize_path
from .portability_package_contracts import PortableFileDescriptor
from .portability_registry import domain,registry
def _path(domain_id,name): return normalize_path(f"portability/{domain_id}/{name}")
def serialize_domain(plan,records):
 info=domain(plan.definition.domain_id); did=info["id"]; rows=[]
 for rec in records:
  rows.append({"domain_id":did,"record_id":rec.record_id,"revision":rec.revision,**dict(rec.fields)})
 if len(rows)>registry()["limits"]["recordsPerDomain"]: raise ValueError("portability_record_limit")
 columns=tuple(sorted({key for row in rows for key in row})) or ("domain_id","record_id","revision")
 if info["format"]=="csv": data=canonical_csv(columns,sorted(rows,key=lambda r:(r["domain_id"],r["record_id"],r["revision"])))
 else: data=canonical_json({"domain":did,"cutoff":plan.cutoff.cutoff_hash,"records":sorted(rows,key=lambda r:(r["record_id"],r["revision"]))})
 schema=canonical_json({"domain":did,"columns":columns,"schemaVersion":plan.schema_version,"serializerVersion":plan.serializer_version})
 readme=(f"Synthetic local fixture: {did}. No customer export or download.\n").encode()
 raw=(("data."+("csv" if info["format"]=="csv" else "json"),data,"text/csv" if info["format"]=="csv" else "application/json",len(rows)),("schema.json",schema,"application/json",0),("readme.txt",readme,"text/plain",0))
 files={}; descriptors=[]
 for name,content,media,count in raw:
  if len(content)>registry()["limits"]["fileBytes"]: raise ValueError("portability_file_limit")
  path=_path(did,name); buf=bytearray(content); files[path]=buf
  descriptors.append(PortableFileDescriptor(did,path,media,plan.schema_version,plan.serializer_version,len(buf),count,plan.cutoff.cutoff_hash,digest(bytes(buf))))
 return files,tuple(descriptors)
def clear_buffers(files):
 for value in files.values(): value[:]=b"\0"*len(value); value.clear()
 files.clear()
