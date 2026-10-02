"""Deterministic grouping and hypothetical routing; it cannot call a model."""
from __future__ import annotations
from collections import defaultdict
from datetime import datetime
from .claim_disagreement_canonical import digest
from .claim_disagreement_definition_contracts import Claim,ClaimMagnitude,EvidenceLink,ExperimentSubject,LedgerScope
from .claim_disagreement_result_contracts import ConflictGroup,EscalationDecision,projection
from .claim_disagreement_registry import registry_hash,scenario
def _claim(item):
 scope=LedgerScope(item["tenant"],item["account"],item["market"])
 ev=tuple(EvidenceLink(**x) for x in item["evidence"])
 mag=ClaimMagnitude(**item["magnitude"]) if item.get("magnitude") else ClaimMagnitude()
 return Claim(item["id"],scope,item["claimType"],item["subject"],item["horizon"],item["polarity"],item["role"],item["family"],ev,item.get("falsifier"),item["expiresAt"],mag,item.get("critical",False))
def _overlap(a,b): return max(x.observed_at for x in a.evidence)<=min(x.expires_at for x in b.evidence)
def evaluate(scenario_id,mode,now,operator,request_hash,context=None):
 if mode not in {"observe","enforce"}: raise ValueError("ledger_mode")
 fixture=scenario(scenario_id); claims=[]; invalid=0
 for item in fixture["claims"]:
  try: claims.append(_claim(item))
  except ValueError: invalid+=1
 by_key=defaultdict(list)
 for claim in claims: by_key[(claim.scope.scope_hash,claim.scope.market,claim.claim_type,claim.subject_id,claim.horizon)].append(claim)
 groups=[]; reasons=[]
 for key,members in sorted(by_key.items()):
  members=tuple(sorted(members,key=lambda x:x.claim_hash)); opposite=len({x.polarity for x in members if x.polarity!="neutral"})>1
  comparable=all(x.magnitude.unit==members[0].magnitude.unit for x in members) and members[0].magnitude.unit is not None
  disjoint=comparable and max(x.magnitude.lower for x in members)>min(x.magnitude.upper for x in members)
  overlap=all(_overlap(members[0],x) for x in members[1:])
  families={x.family for x in members}; critical=any(x.critical for x in members)
  material=(opposite and critical) or (opposite and overlap) or disjoint or len(families)==1 and critical or any(not x.falsifier for x in members if x.critical)
  why=tuple(sorted(set((["opposite_polarity"] if opposite else [])+(["disjoint_magnitude"] if disjoint else [])+(["one_family"] if len(families)==1 and critical else [])+(["missing_falsifier"] if any(not x.falsifier for x in members if x.critical) else []))))
  if material: reasons.extend(why or ["material_conflict"])
  groups.append(ConflictGroup(key,tuple(x.claim_hash for x in members),material,why))
 unresolved=sum(x.material for x in groups)+invalid; tier=fixture["tier"]; baseline=fixture["baselineCalls"]; route="baseline"
 max_calls=baseline; actual=baseline
 if fixture["subject"]=="conditional_escalation":
  if tier=="Focus" and any(x.material for x in groups): route="hypothetical_critic"; max_calls=baseline+1; actual=baseline+1
  elif tier=="Pro" and not any(x.material for x in groups): route="hypothetical_critic_skip"
  elif tier=="Lite": route="no_critic_lite"
 decision=EscalationDecision(route,max_calls,actual,max_calls*100,max_calls*100,max_calls*1000,max_calls*1000,"material" if unresolved else "baseline")
 graph={"operator":operator,"scenarioId":scenario_id,"mode":mode,"requestHash":request_hash,"contextHash":(context or {}).get("contextHash","none"),"registryHash":registry_hash(),"valid":len(claims),"invalid":invalid,"groups":groups,"unresolved":unresolved,"families":len({x.family for x in claims}),"baselineCalls":baseline,"decision":decision,"wouldAbstain":bool(unresolved),"reasons":tuple(sorted(set(reasons or ["no_material_conflict"]))),"recall":10000 if fixture["expectedMaterial"]==bool(unresolved) else 0,"precision":10000 if fixture["expectedMaterial"]==bool(unresolved) else 0,"fixtureHash":digest(fixture)}
 graph["rootHash"]=digest({"claims":[x.claim_hash for x in claims],"groups":[x.group_hash for x in groups],"decision":decision.__dict__,"context":graph["contextHash"],"registry":graph["registryHash"]})
 result={"scenarioId":scenario_id,"fixtureHash":graph["fixtureHash"],"registryHash":graph["registryHash"],"_artifacts":graph}; result.update(projection(graph)); return result
