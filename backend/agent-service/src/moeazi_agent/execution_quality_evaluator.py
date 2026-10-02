"""Exact integer, feasibility-first evaluator for checked-in routing fixtures only."""
from __future__ import annotations
from .execution_quality_canonical import ceil_div,digest
from .execution_quality_registry import registry_hash,scenario
def _candidate(venue,kind,index):
 reasons=[]; source="exact_executable"; healthy=True; reconciled=True; continuity="complete"; depth=75_000; base=1100+index*75
 if kind=="indicative" and index==0: source="indicative"; reasons.append("SOURCE_NOT_SYNTHETIC_EXECUTABLE")
 if kind=="stale" and index==0: reasons.append("STALE_QUOTE")
 if kind=="gap" and index==0: continuity="gap"; reasons.append("BOOK_CONTINUITY_GAP")
 if kind=="health" and index==0: healthy=False; reasons.append("VENUE_HEALTH_UNKNOWN")
 if kind=="reconciliation" and index==0: reconciled=False; reasons.append("RECONCILIATION_UNRESOLVED")
 if kind=="depth" and index==0: depth=0; reasons.append("INSUFFICIENT_DEPTH")
 if kind=="channel" and index==0: reasons.append("CHANNEL_UNCERTIFIED")
 if source not in {"exact_executable","exact_public"}: reasons.append("SOURCE_CLASS_INELIGIBLE")
 if source=="exact_public": reasons.append("PREPARATION_FIXTURE_MISSING")
 if kind=="scope" and index==0: reasons.append("SCOPE_MISMATCH")
 cost=base+250+125+75; eligible=not reasons and healthy and reconciled and continuity=="complete" and depth>0
 return {"venue":venue,"sourceClass":source,"eligible":eligible,"exclusionCodes":sorted(set(reasons)),"allInCostMicrousd":cost,"comparisonCostMicrousd":ceil_div(cost,100)*100,"ageMicros":index+1,"registryPriority":index+1,"bookContinuity":continuity,"freshness":"fresh" if "STALE_QUOTE" not in reasons else "stale"}
def evaluate(identifier,mode,operator,request_hash,context):
 if mode not in {"observe","enforce"}: raise ValueError("execution_quality_mode")
 item=scenario(identifier); kind=item["kind"]; base_context=context or {}
 invalid=base_context.get("trustStatus")!="requires_revalidation" or base_context.get("decision") not in {"approve_for_routing","clamped"} or base_context.get("quantity",0)<=0
 venues=("fixture_amm","fixture_orderbook","fixture_rfq")
 candidates=[_candidate(venue,kind,index) for index,venue in enumerate(venues)]
 if invalid:
  for row in candidates: row.update({"eligible":False,"exclusionCodes":sorted(set(row["exclusionCodes"]+["FEATURE31_BINDING_INVALID"]))})
 eligible=sorted((row for row in candidates if row["eligible"]),key=lambda row:(row["comparisonCostMicrousd"],row["ageMicros"],row["registryPriority"],row["venue"]))
 selected=eligible[0] if eligible else None; runner=eligible[1] if len(eligible)>1 else None
 uncertainty=kind=="uncertain"; decision="hypothetical_route" if selected and not uncertainty else "abstain_no_synthetic_route"
 reasons=[] if selected and not uncertainty else ["SUBMISSION_UNCERTAINTY_LATCH" if uncertainty else "NO_ELIGIBLE_SYNTHETIC_ROUTE"]
 root=digest({"scenario":item,"operator":operator,"request":request_hash,"context":base_context,"registry":registry_hash(),"candidates":candidates,"selected":selected and selected["venue"],"decision":decision,"reasons":reasons})
 return {"scenario":item,"decision":decision,"wouldDecision":decision,"candidateCount":len(candidates),"eligibleCount":len(eligible) if not uncertainty else 0,"excludedCount":len(candidates)-len(eligible)+(1 if uncertainty and selected else 0),"sourceClassCounts":{"exact_executable":sum(x["sourceClass"]=="exact_executable" for x in candidates),"exact_public":0,"indicative":sum(x["sourceClass"]=="indicative" for x in candidates),"proxy":0},"selectedVenue":selected and selected["venue"] if not uncertainty else None,"runnerUpVenue":runner and runner["venue"] if not uncertainty else None,"modeledCostDeltaMicrousd":(runner["comparisonCostMicrousd"]-selected["comparisonCostMicrousd"]) if selected and runner else 0,"bookContinuity":"gap" if kind=="gap" else "complete","recoveryState":"required" if kind=="gap" else "not_required","preflightState":"invalidate" if kind in {"stale","gap","uncertain"} else "keep","lifecycleState":"submission_unknown_latched" if uncertainty else "hypothetical_preflight_complete" if selected else "abstained","uncertaintyLatch":uncertainty,"reasonCodes":reasons,"candidateDecisions":candidates,"rootHash":root,"registryHash":registry_hash(),"contextHash":base_context.get("contextHash","fixture"),"selectedPrerequisiteStatus":"requires_revalidation","invariantVerdict":"pass","fixtureOnly":True,"productOutcome":"unavailable","authorityEffect":"none","providerAttempts":0,"externalAttempts":0,"signerAttempts":0,"walletAttempts":0,"venueAttempts":0,"providerCost":0,"maximumCalls":0,"actualProviderCalls":0,"elapsedMicros":0}
