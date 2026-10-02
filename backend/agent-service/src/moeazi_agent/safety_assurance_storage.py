"""Append-only persistence for one already-verified synthetic corpus run."""
from __future__ import annotations
import json
from hashlib import sha256
from sqlalchemy import text
from .safety_assurance_graph import verify
from .test_center_storage import save_run_on_connection
class AssuranceConflict(RuntimeError): pass
class AssuranceRepository:
 def __init__(self,engine): self.engine=engine
 async def persist_bundle(self,operator,key,request_hash,graph,payload,failpoint=None):
  verify(graph); raw=json.dumps(payload,sort_keys=True,separators=(",",":")); body_hash=sha256(raw.encode()).hexdigest()
  async with self.engine.begin() as c:
   await c.execute(text("SELECT pg_advisory_xact_lock(hashtext(:v))"),{"v":f"assurance:{operator}:{key}"})
   old=(await c.execute(text("SELECT request_hash,payload FROM safety_assurance_request_claims WHERE operator_test_id=:o AND idempotency_key=:k FOR UPDATE"),{"o":operator,"k":key})).mappings().first()
   if old:
    if old["request_hash"]!=request_hash: raise AssuranceConflict("assurance_idempotency_conflict")
    return dict(old["payload"])
   rows=(("safety_assurance_runs",graph["rootHash"],{"root":graph["rootHash"],"status":graph["verdict"].status}), ("safety_assurance_verdicts",graph["verdict"].verdict_hash,{"status":graph["verdict"].status,"qualification":graph["verdict"].qualification_outcome}), ("safety_assurance_roots",graph["rootHash"],{"root":graph["rootHash"],"registry":graph["registryHash"]}))
   for i,(table,artifact,value) in enumerate(rows):
    item=json.dumps(value,sort_keys=True,separators=(",",":")); await c.execute(text(f"INSERT INTO {table}(operator_test_id,run_hash,artifact_hash,payload_hash,payload) VALUES(:o,:r,:a,:h,CAST(:p AS jsonb))"),{"o":operator,"r":graph["rootHash"],"a":artifact,"h":sha256(item.encode()).hexdigest(),"p":item})
    if failpoint==f"after_{i}": raise RuntimeError("assurance_injected_failure")
   for table,items in (("safety_assurance_case_results",graph["cases"]),("safety_assurance_mutation_results",graph["mutations"])):
    for item in items:
     raw_item=json.dumps(item,sort_keys=True,separators=(",",":")); await c.execute(text(f"INSERT INTO {table}(operator_test_id,run_hash,artifact_hash,payload_hash,payload) VALUES(:o,:r,:a,:h,CAST(:p AS jsonb))"),{"o":operator,"r":graph["rootHash"],"a":item["resultHash"],"h":sha256(raw_item.encode()).hexdigest(),"p":raw_item})
   await c.execute(text("INSERT INTO safety_assurance_request_claims(operator_test_id,idempotency_key,request_hash,root_hash,payload_hash,payload) VALUES(:o,:k,:q,:r,:h,CAST(:p AS jsonb))"),{"o":operator,"k":key,"q":request_hash,"r":graph["rootHash"],"h":body_hash,"p":raw})
   if failpoint=="before_generic_run": raise RuntimeError("assurance_injected_failure")
   await save_run_on_connection(c,payload)
   if failpoint=="before_commit": raise RuntimeError("assurance_injected_failure")
  if failpoint=="post_commit_response_loss": raise RuntimeError("assurance_post_commit_response_loss")
  return payload
