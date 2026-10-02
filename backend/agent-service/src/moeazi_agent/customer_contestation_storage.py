"""Atomic append-only storage for Feature 23 synthetic bundles."""
import json
from sqlalchemy import text
class ContestationConflict(RuntimeError): pass
class ContestationRepository:
 def __init__(self,engine): self.engine=engine
 @staticmethod
 def _json(v): return json.dumps(v.model_dump(mode="json") if hasattr(v,"model_dump") else v,sort_keys=True,separators=(",",":"))
 async def persist_bundle(self,operator,key,request_hash,artifacts,payload,failpoint=None):
  conflict=False; scope=artifacts["scope"].scope_hash
  async with self.engine.begin() as c:
   await c.execute(text("SELECT pg_advisory_xact_lock(hashtext(:v))"),{"v":f"contestation:{operator}:{key}"})
   old=(await c.execute(text("SELECT request_hash,payload FROM customer_contestation_request_claims WHERE operator_test_id=:o AND idempotency_key=:k FOR UPDATE"),{"o":operator,"k":key})).mappings().first()
   if old:
    if old["request_hash"]==request_hash:return dict(old["payload"])
    await c.execute(text("INSERT INTO customer_contestation_conflicts(operator_test_id,idempotency_key,request_hash,payload) VALUES(:o,:k,:r,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":operator,"k":key,"r":request_hash,"p":self._json({"code":"IDEMPOTENCY_CONFLICT"})}); conflict=True
   else:
    await self._write(c,operator,scope,artifacts,payload,failpoint)
    await c.execute(text("INSERT INTO customer_contestation_request_claims(operator_test_id,idempotency_key,request_hash,payload) VALUES(:o,:k,:r,CAST(:p AS jsonb))"),{"o":operator,"k":key,"r":request_hash,"p":self._json(payload)})
  if conflict: raise ContestationConflict("customer_contestation_idempotency_conflict")
  return await self.read_claim(operator,key,request_hash)
 async def _write(self,c,o,s,a,p,failpoint):
  rows=(("scopes",s,a["scope"].scope_hash,a["scope"]),("policies",s,a["policy"].policy_hash,a["policy"]),("principals",s,a["principal"].binding_hash,a["principal"]),("feature20_contexts",s,a["feature20_context"].binding_hash,a["feature20_context"]),("submissions",a["submission"].submission_hash,a["submission"].submission_hash,a["submission"]),("cases",a["case"].case_hash,a["case"].case_hash,a["case"]),("investigations",a["investigation"].investigation_hash,a["investigation"].investigation_hash,a["investigation"]),("findings",a["finding"].finding_hash,a["finding"].finding_hash,a["finding"]),("responses",a["response"].response_hash,a["response"].response_hash,a["response"]),("corrections",a["correction"].receipt_hash,a["correction"].receipt_hash,a["correction"]),("remedy_proposals",a["proposal"].proposal_hash,a["proposal"].proposal_hash,a["proposal"]),("authorizations",a["authorization"].authorization_hash,a["authorization"].authorization_hash,a["authorization"]),("remedy_receipts",a["remedy"].receipt_hash,a["remedy"].receipt_hash,a["remedy"]),("closures",a["closure"].receipt_hash,a["closure"].receipt_hash,a["closure"]),("root_manifests",a["manifest"].manifest_hash,a["manifest"].manifest_hash,a["manifest"]))
  for name,key,artifact_hash,item in rows:
   await c.execute(text(f"INSERT INTO customer_contestation_{name}(operator_test_id,scope_hash,artifact_hash,payload) VALUES(:o,:s,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"h":artifact_hash,"p":self._json(item)})
   if failpoint==f"after_{name}": raise RuntimeError("customer_contestation_injected_failure")
  for event in a["events"]: await c.execute(text("INSERT INTO customer_contestation_lifecycle_events(operator_test_id,scope_hash,artifact_hash,sequence,payload) VALUES(:o,:s,:h,:q,CAST(:p AS jsonb))"),{"o":o,"s":s,"h":event.event_hash,"q":event.sequence,"p":self._json(event)})
  for evidence in a["evidence"]: await c.execute(text("INSERT INTO customer_contestation_evidence_refs(operator_test_id,scope_hash,artifact_hash,payload) VALUES(:o,:s,:h,CAST(:p AS jsonb))"),{"o":o,"s":s,"h":evidence.reference_hash,"p":self._json(evidence)})
  for action in a["actions"]: await c.execute(text("INSERT INTO customer_contestation_actions(operator_test_id,scope_hash,artifact_hash,payload) VALUES(:o,:s,:h,CAST(:p AS jsonb))"),{"o":o,"s":s,"h":action.action_hash,"p":self._json(action)})
  await c.execute(text("INSERT INTO customer_contestation_test_center_bundles(operator_test_id,scope_hash,artifact_hash,payload) VALUES(:o,:s,:h,CAST(:p AS jsonb))"),{"o":o,"s":s,"h":a["case"].case_hash,"p":self._json(p)})
 async def read_claim(self,o,k,r):
  async with self.engine.connect() as c:
   row=(await c.execute(text("SELECT payload FROM customer_contestation_request_claims WHERE operator_test_id=:o AND idempotency_key=:k AND request_hash=:r"),{"o":o,"k":k,"r":r})).mappings().first()
   if not row: raise RuntimeError("customer_contestation_readback_missing")
   return dict(row["payload"])
