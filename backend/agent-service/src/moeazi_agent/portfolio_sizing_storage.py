"""Append-only local persistence for synthetic sizing research."""
from __future__ import annotations
import json
from hashlib import sha256
from sqlalchemy import text
from .test_center_storage import save_run_on_connection
class PortfolioSizingConflict(RuntimeError): pass
class PortfolioSizingRepository:
 def __init__(self,engine): self.engine=engine
 async def persist_bundle(self,operator,key,request_hash,graph,payload,failpoint=None):
  encoded=json.dumps(payload,sort_keys=True,separators=(",",":")); payload_hash=sha256(encoded.encode()).hexdigest()
  async with self.engine.begin() as connection:
   await connection.execute(text("SELECT pg_advisory_xact_lock(hashtext(:value))"),{"value":f"portfolio-sizing:{operator}:{key}"})
   old=(await connection.execute(text("SELECT request_hash,payload FROM portfolio_sizing_request_claims WHERE operator_test_id=:operator AND idempotency_key=:key FOR UPDATE"),{"operator":operator,"key":key})).mappings().first()
   if old:
    if old["request_hash"]!=request_hash: raise PortfolioSizingConflict("portfolio_sizing_idempotency_conflict")
    return dict(old["payload"])
   root=graph["rootHash"]; body=json.dumps({"root":root,"registry":graph["registryHash"]},sort_keys=True,separators=(",",":"))
   await connection.execute(text("INSERT INTO portfolio_sizing_runs(operator_test_id,run_hash,payload_hash,payload) VALUES(:operator,:root,:hash,CAST(:body AS jsonb))"),{"operator":operator,"root":root,"hash":sha256(body.encode()).hexdigest(),"body":body})
   await connection.execute(text("INSERT INTO portfolio_sizing_decisions(operator_test_id,run_hash,artifact_hash,payload_hash,payload) VALUES(:operator,:root,:artifact,:hash,CAST(:body AS jsonb))"),{"operator":operator,"root":root,"artifact":root,"hash":payload_hash,"body":encoded})
   await connection.execute(text("INSERT INTO portfolio_sizing_request_claims(operator_test_id,idempotency_key,request_hash,run_hash,payload_hash,payload) VALUES(:operator,:key,:request,:root,:hash,CAST(:body AS jsonb))"),{"operator":operator,"key":key,"request":request_hash,"root":root,"hash":payload_hash,"body":encoded})
   if failpoint in {"before_generic_run","before_commit"}: raise RuntimeError("portfolio_sizing_injected_failure")
   await save_run_on_connection(connection,payload)
  if failpoint=="post_commit_response_loss": raise RuntimeError("portfolio_sizing_post_commit_response_loss")
  return payload
