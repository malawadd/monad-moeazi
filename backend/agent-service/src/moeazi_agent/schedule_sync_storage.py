"""Append-only persistence for synthetic Schedule Sync bundles only."""
from __future__ import annotations
import json
from hashlib import sha256
from sqlalchemy import text
from .schedule_sync_canonical import canonical
from .schedule_sync_graph import verify
from .schedule_sync_result_contracts import ScheduleSyncConflict
from .test_center_storage import save_run_on_connection
class ScheduleSyncRepository:
 def __init__(self,engine): self.engine=engine
 @staticmethod
 def _body(value):
  if hasattr(value,"__dict__"): value=value.__dict__
  return canonical(value)
 async def persist_bundle(self,operator,key,request_hash,graph,payload,failpoint=None):
  verify(graph); scope=graph["scope"].scope_hash
  if graph["scope"].operator_test_id!=operator: raise ValueError("schedule_sync_operator_scope_mismatch")
  body=self._body(payload); body_hash=sha256(body.encode()).hexdigest()
  async with self.engine.begin() as c:
   await c.execute(text("SELECT pg_advisory_xact_lock(hashtext(:v))"),{"v":f"schedule-sync:{operator}:{key}"})
   old=(await c.execute(text("SELECT request_hash,payload_hash,payload FROM schedule_sync_request_claims WHERE operator_test_id=:o AND idempotency_key=:k FOR UPDATE"),{"o":operator,"k":key})).mappings().first()
   if old:
    if old["request_hash"]!=request_hash: raise ScheduleSyncConflict("schedule_sync_idempotency_conflict")
    if old["payload_hash"]!=sha256(self._body(dict(old["payload"])).encode()).hexdigest(): raise RuntimeError("schedule_sync_readback_corrupt")
    return dict(old["payload"])
   rows=(("schedule_sync_scopes",scope,{"scope":scope}), ("schedule_sync_desired_states",graph["state"].desired_hash,graph["state"].__dict__), ("schedule_sync_material_decisions",graph["decision"].decision_hash,graph["decision"].__dict__), ("schedule_sync_actual_observations",graph["actual"].actual_hash,graph["actual"].__dict__), ("schedule_sync_roots",graph["root"].root_hash,graph["root"].__dict__))
   for index,(table,artifact,value) in enumerate(rows):
    raw=self._body(value); await c.execute(text(f"INSERT INTO {table}(operator_test_id,scope_hash,artifact_hash,payload_hash,payload) VALUES(:o,:s,:a,:h,CAST(:p AS jsonb))"),{"o":operator,"s":scope,"a":artifact,"h":sha256(raw.encode()).hexdigest(),"p":raw})
    if failpoint==f"after_{index}": raise RuntimeError("schedule_sync_injected_failure")
   if graph["command"]:
    command=graph["command"]; raw=self._body(command); await c.execute(text("INSERT INTO schedule_sync_commands(operator_test_id,scope_hash,artifact_hash,profile_revision,desired_hash,payload_hash,payload) VALUES(:o,:s,:a,:r,:d,:h,CAST(:p AS jsonb))"),{"o":operator,"s":scope,"a":command.command_id,"r":command.profile_revision,"d":command.desired_hash,"h":sha256(raw.encode()).hexdigest(),"p":raw})
    for transition in graph["transitions"]:
     raw=self._body(transition); await c.execute(text("INSERT INTO schedule_sync_transitions(operator_test_id,scope_hash,artifact_hash,command_hash,sequence,payload_hash,payload) VALUES(:o,:s,:a,:c,:q,:h,CAST(:p AS jsonb))"),{"o":operator,"s":scope,"a":transition.transition_hash,"c":command.command_id,"q":transition.sequence,"h":sha256(raw.encode()).hexdigest(),"p":raw})
   await c.execute(text("INSERT INTO schedule_sync_request_claims(operator_test_id,idempotency_key,request_hash,root_hash,payload_hash,payload) VALUES(:o,:k,:r,:root,:h,CAST(:p AS jsonb))"),{"o":operator,"k":key,"r":request_hash,"root":graph["root"].root_hash,"h":body_hash,"p":body})
   if failpoint=="before_generic_run": raise RuntimeError("schedule_sync_injected_failure")
   await save_run_on_connection(c,payload)
   if failpoint=="before_commit": raise RuntimeError("schedule_sync_injected_failure")
  if failpoint=="post_commit_response_loss": raise RuntimeError("schedule_sync_post_commit_response_loss")
  return payload
