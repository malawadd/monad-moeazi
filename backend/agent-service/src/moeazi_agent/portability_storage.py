"""Append-only persistence for safe Feature 24 metadata, never virtual file bytes."""
from __future__ import annotations
import json
from dataclasses import asdict,is_dataclass
from hashlib import sha256
from sqlalchemy import text
from .portability_canonical import digest
from .portability_evaluator import validate_graph
from .test_center_storage import save_run_on_connection
class PortabilityConflict(RuntimeError): pass
FAILPOINTS=("after_scope","after_policy","after_synthetic_auth","after_feature03_context","after_request","after_domain_plans","after_cutoffs","after_source_record_refs","after_field_decisions","after_omissions","after_domain_receipts","after_file_descriptors","after_manifest","after_assembly","after_verification","after_grant","after_delivery_attempt","after_delivery_receipt","after_cleanup","after_state_snapshot","after_root_manifest","after_test_center_bundle","after_request_claim","after_generic_run")
class PortabilityRepository:
 def __init__(self,engine): self.engine=engine
 def _safe(self,item):
  def convert(value):
   if is_dataclass(value): return {key:convert(part) for key,part in asdict(value).items()}
   if isinstance(value,dict): return {key:convert(part) for key,part in value.items()}
   if isinstance(value,(tuple,list)): return [convert(part) for part in value]
   return value
  value=convert(item)
  return json.dumps(value,sort_keys=True,separators=(",",":"),default=str)
 def _payload_hash(self,body): return sha256(body.encode()).hexdigest()
 async def persist_bundle(self,operator,key,request_hash,graph,payload,failpoint=None):
  scope=graph["scope"].scope_hash; conflict=False
  if graph["scope"].operator_test_id!=operator: raise ValueError("portability_operator_scope_mismatch")
  validate_graph(graph)
  async with self.engine.begin() as c:
   await c.execute(text("SELECT pg_advisory_xact_lock(hashtext(:v))"),{"v":f"portability:{operator}:{key}"})
   old=(await c.execute(text("SELECT request_hash,payload FROM portability_request_claims WHERE operator_test_id=:o AND idempotency_key=:k FOR UPDATE"),{"o":operator,"k":key})).mappings().first()
   if old:
    if old["request_hash"]==request_hash:return dict(old["payload"])
    await c.execute(text("INSERT INTO portability_conflicts(operator_test_id,idempotency_key,request_hash,payload_hash,payload) VALUES(:o,:k,:r,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":operator,"k":key,"r":request_hash,"h":digest("IDEMPOTENCY_CONFLICT"),"p":self._safe({"code":"REQUEST_CONFLICT"})}); conflict=True
   else:
    await self._write(c,operator,scope,graph,failpoint)
    if failpoint=="after_test_center_bundle": raise RuntimeError("portability_injected_failure")
    body=self._safe(payload); await c.execute(text("INSERT INTO portability_request_claims(operator_test_id,idempotency_key,request_hash,payload_hash,payload) VALUES(:o,:k,:r,:h,CAST(:p AS jsonb))"),{"o":operator,"k":key,"r":request_hash,"h":self._payload_hash(body),"p":body})
    if failpoint=="after_request_claim": raise RuntimeError("portability_injected_failure")
    if "runId" in payload: await save_run_on_connection(c,payload)
    if failpoint=="after_generic_run": raise RuntimeError("portability_injected_failure")
  if conflict: raise PortabilityConflict("portability_idempotency_conflict")
  return await self.read_claim(operator,key,request_hash)
 async def _insert_many(self,c,table,o,s,items,sequence=False):
  sql=f"INSERT INTO {table}(operator_test_id,scope_hash,artifact_hash"+(",sequence" if sequence else "")+",payload_hash,payload) VALUES(:o,:s,:a"+(",:q" if sequence else "")+",:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"
  rows=[]
  for item in items:
   body=self._safe(item); h=getattr(item,"scope_hash",None) or getattr(item,"policy_hash",None) or getattr(item,"plan_hash",None) or getattr(item,"receipt_hash",None) or getattr(item,"descriptor_hash",None) or getattr(item,"manifest_hash",None) or getattr(item,"grant_hash",None) or getattr(item,"attempt_hash",None) or getattr(item,"snapshot_hash",None) or getattr(item,"root_hash",None) or digest(body)
   rows.append({"o":o,"s":s,"a":h,"q":getattr(item,"sequence",None),"h":self._payload_hash(body),"p":body})
  if rows: await c.execute(text(sql),rows)
 async def _insert_all(self,c,o,s,groups):
  """One round trip for normal first-writes; failpoint probes retain per-family cuts."""
  ctes=[]; params={"o":o,"s":s}
  for number,(table,items,sequence) in enumerate(groups):
   values=[]
   for index,item in enumerate(items):
    body=self._safe(item); artifact=getattr(item,"scope_hash",None) or getattr(item,"policy_hash",None) or getattr(item,"plan_hash",None) or getattr(item,"receipt_hash",None) or getattr(item,"descriptor_hash",None) or getattr(item,"manifest_hash",None) or getattr(item,"grant_hash",None) or getattr(item,"attempt_hash",None) or getattr(item,"snapshot_hash",None) or getattr(item,"root_hash",None) or digest(body)
    suffix=f"{number}_{index}"; params.update({f"a{suffix}":artifact,f"h{suffix}":self._payload_hash(body),f"p{suffix}":body,f"q{suffix}":getattr(item,"sequence",None)})
    values.append(f"(:o,:s,:a{suffix}"+(f",:q{suffix}" if sequence else "")+f",:h{suffix},CAST(:p{suffix} AS jsonb))")
   if values: ctes.append(f"w{number} AS (INSERT INTO {table}(operator_test_id,scope_hash,artifact_hash"+(",sequence" if sequence else "")+",payload_hash,payload) VALUES "+",".join(values)+" ON CONFLICT DO NOTHING RETURNING 1)")
  if ctes: await c.execute(text("WITH "+",".join(ctes)+" SELECT 1"),params)
 async def _write(self,c,o,s,g,failpoint):
  body=self._safe(g["scope"]); await c.execute(text("INSERT INTO portability_scopes(operator_test_id,scope_hash,payload_hash,payload) VALUES(:o,:s,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"h":self._payload_hash(body),"p":body})
  if failpoint=="after_scope": raise RuntimeError("portability_injected_failure")
  request_body=self._safe({"request":g["root"].request_hash}); await c.execute(text("INSERT INTO portability_requests(operator_test_id,scope_hash,request_hash,payload_hash,payload) VALUES(:o,:s,:r,:h,CAST(:p AS jsonb))"),{"o":o,"s":s,"r":g["root"].request_hash,"h":self._payload_hash(request_body),"p":request_body})
  if failpoint=="after_request": raise RuntimeError("portability_injected_failure")
  rows=(("portability_policies",g["policy"]),("portability_synthetic_auth",g["stepUp"]),("portability_feature03_contexts",g["context"]),("portability_domain_plans",g["plans"]),("portability_cutoffs",tuple(x.cutoff for x in g["plans"])),("portability_source_record_refs",tuple({"plan":x.plan_hash,"reference":"synthetic"} for x in g["plans"])),("portability_field_decisions",tuple({"plan":x.plan_hash,"decision":"synthetic"} for x in g["plans"])),("portability_omissions",g["omissions"]),("portability_domain_receipts",g["receipts"]),("portability_file_descriptors",g["files"]),("portability_manifests",g["manifest"]),("portability_assembly_receipts",g["assembly"]),("portability_verification_receipts",g["verification"]),("portability_grants",g["grant"]),("portability_delivery_receipts",g["delivery"]),("portability_cleanup_receipts",g["cleanup"]),("portability_state_snapshots",g["state"]),("portability_root_manifests",g["root"]),("portability_test_center_bundles",{"root":g["root"].root_hash}))
  groups=tuple((family,item if isinstance(item,tuple) else (item,),False) for family,item in rows)+((("portability_delivery_attempts",(g["attempt"],),True),) if g.get("attempt") else ())
  if not failpoint: await self._insert_all(c,o,s,groups); return
  for family,item,sequence in groups:
   await self._insert_many(c,family,o,s,item,sequence)
   point={"portability_policies":"after_policy","portability_feature03_contexts":"after_feature03_context", "portability_manifests":"after_manifest","portability_assembly_receipts":"after_assembly","portability_verification_receipts":"after_verification","portability_grants":"after_grant","portability_delivery_receipts":"after_delivery_receipt","portability_cleanup_receipts":"after_cleanup","portability_state_snapshots":"after_state_snapshot","portability_root_manifests":"after_root_manifest","portability_delivery_attempts":"after_delivery_attempt"}.get(family,f"after_{family.removeprefix('portability_')}")
   if failpoint==point: raise RuntimeError("portability_injected_failure")
  if failpoint=="after_delivery_attempt": raise RuntimeError("portability_injected_failure")
 async def read_claim(self,o,k,r):
  async with self.engine.connect() as c:
   row=(await c.execute(text("SELECT payload,payload_hash FROM portability_request_claims WHERE operator_test_id=:o AND idempotency_key=:k AND request_hash=:r"),{"o":o,"k":k,"r":r})).mappings().first()
  if not row: raise RuntimeError("portability_readback_missing")
  if self._payload_hash(self._safe(dict(row["payload"])))!=row["payload_hash"]: raise RuntimeError("portability_readback_corrupt")
  return dict(row["payload"])
