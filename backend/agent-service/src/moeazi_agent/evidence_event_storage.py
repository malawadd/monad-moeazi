"""Append-only repository for the isolated Evidence Event Fabric graph."""
from __future__ import annotations
import json
from hashlib import sha256
from sqlalchemy import text
from .evidence_event_graph import validate_graph
from .test_center_storage import save_run_on_connection

class EvidenceEventConflict(RuntimeError): pass
FAMILIES=("scope","adapter_manifests","contexts","deliveries","events","relations","quarantines","quality_assessments","quality_dimensions","freshness_policies","freshness_decisions","materiality_policies","materiality_decisions","watermarks","triggers","trigger_members","dispatch","replay","replay_members","missing_sources","analytical","state","root","bundle")
FAILPOINTS=tuple(f"after_{name}" for name in FAMILIES)+("before_generic_run","before_commit","post_commit_response_loss")

class EvidenceEventRepository:
 def __init__(self,engine): self.engine=engine
 @staticmethod
 def _body(value): return json.dumps(value,sort_keys=True,separators=(",",":"),default=lambda x:getattr(x,"__dict__",str(x)))
 @classmethod
 def _hash(cls,value): return sha256(cls._body(value).encode()).hexdigest()
 async def _plain(self,c,table,o,s,artifact,item):
  raw=self._body(item); h=sha256(raw.encode()).hexdigest()
  row=(await c.execute(text(f"SELECT payload_hash FROM {table} WHERE operator_test_id=:o AND scope_hash=:s AND artifact_hash=:a"),{"o":o,"s":s,"a":artifact})).scalar()
  if row is None: await c.execute(text(f"INSERT INTO {table}(operator_test_id,scope_hash,artifact_hash,payload_hash,payload) VALUES(:o,:s,:a,:h,CAST(:p AS jsonb))"),{"o":o,"s":s,"a":artifact,"h":h,"p":raw})
  elif row!=h: raise RuntimeError("evidence_artifact_payload_conflict")
 async def _family(self,c,name,o,s,g):
  if name=="scope":
   raw=self._body(g["scope"]); h=sha256(raw.encode()).hexdigest(); row=(await c.execute(text("SELECT payload_hash FROM evidence_event_scopes WHERE operator_test_id=:o AND scope_hash=:s"),{"o":o,"s":s})).scalar()
   if row is None: await c.execute(text("INSERT INTO evidence_event_scopes VALUES(:o,:s,:h,CAST(:p AS jsonb))"),{"o":o,"s":s,"h":h,"p":raw})
   elif row!=h: raise RuntimeError("evidence_scope_payload_conflict")
  elif name=="adapter_manifests":
   item={"origin":"checked_in_fixture","networkEnabled":False,"maximumCostMicrousd":0}; await self._plain(c,"evidence_event_adapter_manifests",o,s,self._hash(item),item)
  elif name=="contexts": await self._plain(c,"evidence_event_feature03_contexts",o,s,g["context"].context_hash,g["context"])
  elif name in {"deliveries","quarantines"}:
   table="evidence_event_"+name
   for item in g[name]: await self._plain(c,table,o,s,getattr(item,"delivery_hash",getattr(item,"receipt_hash",self._hash(item))),item)
  elif name=="events":
   for item in g["events"]:
    raw=self._body(item); h=sha256(raw.encode()).hexdigest(); row=(await c.execute(text("SELECT payload_hash FROM evidence_event_events WHERE operator_test_id=:o AND scope_hash=:s AND event_hash=:a"),{"o":o,"s":s,"a":item.event_hash})).scalar()
    if row is None: await c.execute(text("INSERT INTO evidence_event_events(operator_test_id,scope_hash,event_hash,source_id,source_event_id,revision,supersedes_hash,payload_hash,payload) VALUES(:o,:s,:a,:source,:event,:revision,:prior,:h,CAST(:p AS jsonb))"),{"o":o,"s":s,"a":item.event_hash,"source":item.source_id,"event":item.source_event_id,"revision":item.revision,"prior":item.supersedes_hash,"h":h,"p":raw})
    elif row!=h: raise RuntimeError("evidence_artifact_payload_conflict")
  elif name=="relations":
   for item in g["events"]:
    if item.supersedes_hash:
     relation={"source":item.event_hash,"target":item.supersedes_hash,"kind":"supersedes"}; a=self._hash(relation); raw=self._body(relation)
     await c.execute(text("INSERT INTO evidence_event_relations VALUES(:o,:s,:a,:source,:target,'supersedes',:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"a":a,"source":item.event_hash,"target":item.supersedes_hash,"h":sha256(raw.encode()).hexdigest(),"p":raw})
  elif name=="quality_assessments":
   policy=self._hash({"quality":g["quality"]})
   for item in g["events"]:
    a=self._hash({"event":item.event_hash,"policy":policy}); await self._quality(c,o,s,a,item.event_hash,policy,{"quality":g["quality"]})
  elif name=="quality_dimensions":
   policy=self._hash({"quality":g["quality"]})
   for item in g["events"]:
    a=self._hash({"event":item.event_hash,"policy":policy})
    for dimension,status in g["quality"].items():
     raw=self._body({"status":status}); await c.execute(text("INSERT INTO evidence_event_quality_dimensions VALUES(:o,:s,:a,:d,:status,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"a":a,"d":dimension,"status":status,"h":sha256(raw.encode()).hexdigest(),"p":raw})
  elif name in {"freshness_policies","materiality_policies"}:
   item={"value":g["state"]["freshness" if "freshness" in name else "materiality"]}; await self._plain(c,"evidence_event_"+name,o,s,self._hash(item),item)
  elif name in {"freshness_decisions","materiality_decisions"}:
   item={"value":g["state"]["freshness" if "freshness" in name else "materiality"]}; raw=self._body(item); table="evidence_event_"+name
   await c.execute(text(f"INSERT INTO {table}(operator_test_id,scope_hash,artifact_hash,policy_hash,payload_hash,payload) VALUES(:o,:s,:a,NULL,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"a":self._hash(item),"h":sha256(raw.encode()).hexdigest(),"p":raw})
  elif name=="watermarks":
   for item in g["watermarks"]:
    raw=self._body(item); a=self._hash(item); await c.execute(text("INSERT INTO evidence_event_watermark_transitions VALUES(:o,:s,:a,:source,:previous,:sequence,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"a":a,"source":item.source_id,"previous":item.previous_sequence,"sequence":item.sequence,"h":sha256(raw.encode()).hexdigest(),"p":raw})
  elif name=="triggers":
   item=g["trigger"]; raw=self._body(item); a=self._hash(item); await c.execute(text("INSERT INTO evidence_event_trigger_intents VALUES(:o,:s,:a,:w,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"a":a,"w":item["desiredWorkflowIdentity"],"h":sha256(raw.encode()).hexdigest(),"p":raw}); g["_trigger_hash"]=a
  elif name=="trigger_members":
   for n,event in enumerate(g["trigger"]["eventHashes"]):
    raw=self._body({"event":event,"sequence":n}); await c.execute(text("INSERT INTO evidence_event_trigger_members VALUES(:o,:s,:t,:e,:n,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"t":g["_trigger_hash"],"e":event,"n":n,"h":sha256(raw.encode()).hexdigest(),"p":raw})
  elif name=="dispatch":
   item=g["dispatch"]; raw=self._body(item); await c.execute(text("INSERT INTO evidence_event_dispatch_observations VALUES(:o,:s,:a,:t,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"a":self._hash(item),"t":g["_trigger_hash"],"h":sha256(raw.encode()).hexdigest(),"p":raw})
  elif name=="replay": await self._plain(c,"evidence_event_replay_manifests",o,s,g["manifest"]["manifestHash"],g["manifest"])
  elif name=="replay_members":
   for n,event in enumerate(g["manifest"]["eventHashes"]):
    raw=self._body({"event":event,"sequence":n}); await c.execute(text("INSERT INTO evidence_event_replay_manifest_events VALUES(:o,:s,:m,:e,:n,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"m":g["manifest"]["manifestHash"],"e":event,"n":n,"h":sha256(raw.encode()).hexdigest(),"p":raw})
  elif name=="missing_sources": pass
  elif name=="analytical":
   item=g["analytical"]; raw=self._body(item); await c.execute(text("INSERT INTO evidence_event_analytical_manifests VALUES(:o,:s,:a,:m,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"a":item["analyticalHash"],"m":g["manifest"]["manifestHash"],"h":sha256(raw.encode()).hexdigest(),"p":raw})
  elif name=="state":
   item=g["state"]; raw=self._body(item); await c.execute(text("INSERT INTO evidence_event_state_snapshots VALUES(:o,:s,:a,:m,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"a":item["stateHash"],"m":g["manifest"]["manifestHash"],"h":sha256(raw.encode()).hexdigest(),"p":raw})
  elif name=="root":
   item=g["root"]; raw=self._body(item); await c.execute(text("INSERT INTO evidence_event_roots VALUES(:o,:s,:a,:state,:manifest,:context,:request,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"a":item["rootHash"],"state":g["state"]["stateHash"],"manifest":g["manifest"]["manifestHash"],"context":g["context"].context_hash,"request":item["requestHash"],"h":sha256(raw.encode()).hexdigest(),"p":raw})
  elif name=="bundle":
   item={"root":g["root"]["rootHash"]}; raw=self._body(item)
   await c.execute(text("INSERT INTO evidence_event_test_center_bundles VALUES(:o,:s,:a,:root,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"a":g["root"]["rootHash"],"root":g["root"]["rootHash"],"h":sha256(raw.encode()).hexdigest(),"p":raw})
 async def _quality(self,c,o,s,a,event,policy,item):
  raw=self._body(item); await c.execute(text("INSERT INTO evidence_event_quality_assessments VALUES(:o,:s,:a,:e,:policy,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":o,"s":s,"a":a,"e":event,"policy":policy,"h":sha256(raw.encode()).hexdigest(),"p":raw})
 async def persist_bundle(self,operator,key,request_hash,graph,payload,failpoint=None):
  validate_graph(graph); scope=graph["scope"].scope_hash
  if graph["scope"].operator_test_id!=operator: raise ValueError("evidence_operator_scope_mismatch")
  if failpoint not in {*FAILPOINTS,None}: raise ValueError("evidence_failpoint_invalid")
  body=self._body(payload); payload_hash=sha256(body.encode()).hexdigest(); conflict=False
  async with self.engine.begin() as c:
   await c.execute(text("SELECT pg_advisory_xact_lock(hashtext(:v))"),{"v":f"evidence:{operator}:{key}"})
   await c.execute(text("SELECT pg_advisory_xact_lock(hashtext(:v))"),{"v":f"evidence-scope:{operator}:{scope}"})
   old=(await c.execute(text("SELECT request_hash,payload,payload_hash FROM evidence_event_request_claims WHERE operator_test_id=:o AND idempotency_key=:k FOR UPDATE"),{"o":operator,"k":key})).mappings().first()
   if old:
    if old["request_hash"]!=request_hash: conflict=True
    elif self._hash(dict(old["payload"]))!=old["payload_hash"]: raise RuntimeError("evidence_readback_corrupt")
    else: return await self.read_claim(operator,key,request_hash)
   if not conflict:
    for family in FAMILIES:
     await self._family(c,family,operator,scope,graph)
     if failpoint==f"after_{family}": raise RuntimeError("evidence_injected_failure")
    await c.execute(text("INSERT INTO evidence_event_request_claims VALUES(:o,:k,:r,:root,:h,CAST(:p AS jsonb))"),{"o":operator,"k":key,"r":request_hash,"root":graph["root"]["rootHash"],"h":payload_hash,"p":body})
    if failpoint=="before_generic_run": raise RuntimeError("evidence_injected_failure")
    await save_run_on_connection(c,payload)
    if failpoint=="before_commit": raise RuntimeError("evidence_injected_failure")
  if conflict:
   async with self.engine.begin() as c:
    raw=self._body({"code":"REQUEST_CONFLICT"}); await c.execute(text("INSERT INTO evidence_event_conflicts VALUES(:o,:k,:r,:h,CAST(:p AS jsonb)) ON CONFLICT DO NOTHING"),{"o":operator,"k":key,"r":request_hash,"h":sha256(raw.encode()).hexdigest(),"p":raw})
   raise EvidenceEventConflict("evidence_idempotency_conflict")
  if failpoint=="post_commit_response_loss": raise RuntimeError("evidence_post_commit_response_loss")
  return await self.read_claim(operator,key,request_hash)
 async def read_claim(self,operator,key,request_hash):
  async with self.engine.connect() as c:
   row=(await c.execute(text("SELECT payload,payload_hash,root_hash FROM evidence_event_request_claims WHERE operator_test_id=:o AND idempotency_key=:k AND request_hash=:r"),{"o":operator,"k":key,"r":request_hash})).mappings().first()
   if not row or not row["root_hash"]: raise RuntimeError("evidence_readback_missing")
   root=await c.scalar(text("SELECT count(*) FROM evidence_event_roots WHERE operator_test_id=:o AND artifact_hash=:root"),{"o":operator,"root":row["root_hash"]})
  if not root or self._hash(dict(row["payload"]))!=row["payload_hash"]: raise RuntimeError("evidence_readback_corrupt")
  return dict(row["payload"])
