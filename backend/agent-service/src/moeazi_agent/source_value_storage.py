"""Atomic append-only persistence for a validated local source-value run."""
from __future__ import annotations
import json
from hashlib import sha256
from sqlalchemy import text
from .test_center_storage import save_run_on_connection
class SourceValueConflict(RuntimeError): pass
class SourceValueRepository:
 def __init__(self,engine): self.engine=engine
 async def persist_bundle(self,operator,key,request_hash,graph,payload,failpoint=None):
  raw=json.dumps(payload,sort_keys=True,separators=(",",":")); payload_hash=sha256(raw.encode()).hexdigest()
  async with self.engine.begin() as connection:
   await connection.execute(text("SELECT pg_advisory_xact_lock(hashtext(:value))"),{"value":f"source-value:{operator}:{key}"})
   old=(await connection.execute(text("SELECT request_hash,payload FROM source_value_request_claims WHERE operator_test_id=:operator AND idempotency_key=:key FOR UPDATE"),{"operator":operator,"key":key})).mappings().first()
   if old:
    if old["request_hash"]!=request_hash: raise SourceValueConflict("source_value_idempotency_conflict")
    return dict(old["payload"])
   root=graph["rootHash"]; body=json.dumps({"root":root,"registry":graph["registryHash"]},sort_keys=True,separators=(",",":"))
   await connection.execute(text("INSERT INTO source_value_runs(operator_test_id,run_hash,payload_hash,payload) VALUES(:operator,:root,:hash,CAST(:body AS jsonb))"),{"operator":operator,"root":root,"hash":sha256(body.encode()).hexdigest(),"body":body})
   artifacts=(("source_value_citations",graph["citation"].resolution_hash,{"supporting":graph["citation"].supporting}), ("source_value_role_statuses",graph["status"].status_hash,{"status":graph["status"].status}), ("source_value_estimates",sha256(str(graph["estimate"]).encode()).hexdigest(),graph["estimate"].__dict__))
   for table,artifact,value in artifacts:
    encoded=json.dumps(value,sort_keys=True,separators=(",",":")); await connection.execute(text(f"INSERT INTO {table}(operator_test_id,run_hash,artifact_hash,payload_hash,payload) VALUES(:operator,:root,:artifact,:hash,CAST(:body AS jsonb))"),{"operator":operator,"root":root,"artifact":artifact,"hash":sha256(encoded.encode()).hexdigest(),"body":encoded})
   await connection.execute(text("INSERT INTO source_value_request_claims(operator_test_id,idempotency_key,request_hash,run_hash,payload_hash,payload) VALUES(:operator,:key,:request,:root,:hash,CAST(:body AS jsonb))"),{"operator":operator,"key":key,"request":request_hash,"root":root,"hash":payload_hash,"body":raw})
   if failpoint in {"before_generic_run","before_commit"}: raise RuntimeError("source_value_injected_failure")
   await save_run_on_connection(connection,payload)
  if failpoint=="post_commit_response_loss": raise RuntimeError("source_value_post_commit_response_loss")
  return payload
