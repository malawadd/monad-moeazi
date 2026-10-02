"""Atomic append-only persistence for the synthetic disagreement graph."""
from __future__ import annotations
import json
from hashlib import sha256
from sqlalchemy import text
from .test_center_storage import save_run_on_connection
class ClaimLedgerConflict(RuntimeError): pass
class ClaimLedgerRepository:
 def __init__(self,engine): self.engine=engine
 async def persist_bundle(self,operator,key,request_hash,graph,payload,failpoint=None):
  raw=json.dumps(payload,sort_keys=True,separators=(",",":")); payload_hash=sha256(raw.encode()).hexdigest()
  async with self.engine.begin() as c:
   await c.execute(text("SELECT pg_advisory_xact_lock(hashtext(:v))"),{"v":f"ledger:{operator}:{key}"})
   old=(await c.execute(text("SELECT request_hash,payload FROM claim_ledger_request_claims WHERE operator_test_id=:o AND idempotency_key=:k FOR UPDATE"),{"o":operator,"k":key})).mappings().first()
   if old:
    if old["request_hash"]!=request_hash: raise ClaimLedgerConflict("ledger_idempotency_conflict")
    return dict(old["payload"])
   root=graph["rootHash"]; encoded=json.dumps({"root":root,"registry":graph["registryHash"]},sort_keys=True,separators=(",",":"))
   await c.execute(text("INSERT INTO claim_ledger_runs(operator_test_id,run_hash,payload_hash,payload) VALUES(:o,:r,:h,CAST(:p AS jsonb))"),{"o":operator,"r":root,"h":sha256(encoded.encode()).hexdigest(),"p":encoded})
   for name,value,status in (("current",{"calls":graph["baselineCalls"]},"baseline"),("ledger_only",{"valid":graph["valid"]},"valid"),("conditional_escalation",graph["decision"].__dict__,graph["decision"].route)):
    item=json.dumps(value,sort_keys=True,separators=(",",":")); await c.execute(text("INSERT INTO claim_ledger_subjects(operator_test_id,run_hash,subject_id,status,payload_hash,payload) VALUES(:o,:r,:s,CAST(:z AS claim_ledger_status),:h,CAST(:p AS jsonb))"),{"o":operator,"r":root,"s":name,"z":status,"h":sha256(item.encode()).hexdigest(),"p":item})
   for group in graph["groups"]:
    item=json.dumps({"members":group.members,"reasons":group.reasons},sort_keys=True,separators=(",",":")); await c.execute(text("INSERT INTO claim_ledger_groups(operator_test_id,run_hash,group_hash,status,payload_hash,payload) VALUES(:o,:r,:g,:s,:h,CAST(:p AS jsonb))"),{"o":operator,"r":root,"g":group.group_hash,"s":"material" if group.material else "valid","h":sha256(item.encode()).hexdigest(),"p":item})
   await c.execute(text("INSERT INTO claim_ledger_request_claims(operator_test_id,idempotency_key,request_hash,run_hash,payload_hash,payload) VALUES(:o,:k,:q,:r,:h,CAST(:p AS jsonb))"),{"o":operator,"k":key,"q":request_hash,"r":root,"h":payload_hash,"p":raw})
   if failpoint in {"before_generic_run","before_commit"}: raise RuntimeError("ledger_injected_failure")
   await save_run_on_connection(c,payload)
  if failpoint=="post_commit_response_loss": raise RuntimeError("ledger_post_commit_response_loss")
  return payload
