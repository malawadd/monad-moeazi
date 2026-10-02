"""Pure deterministic triage. It creates no reservation, task, or provider call."""
from .run_planning_canonical import digest
from .run_planning_registry import obligations,policy,registry_hash,routes,scenarios
def scenario(identifier):
 item=next((x for x in scenarios() if x["id"]==identifier),None)
 if not item: raise ValueError("run_planning_unknown_scenario")
 return item
def evaluate(identifier,mode,operator,request_hash,context):
 if mode not in {"observe","enforce"}: raise ValueError("run_planning_mode")
 item=scenario(identifier); binding=context or {}; invalid=binding.get("trustStatus")!="requires_revalidation" or not binding.get("zeroAttempts")
 kind=item["kind"]; reasons=[]
 if invalid: reasons.append("PREDECESSOR_BINDING_INVALID")
 if kind in {"unknown","stale","gap","budget","conflict"}: reasons.append({"unknown":"UNKNOWN_EVIDENCE","stale":"STALE_EVIDENCE","gap":"SOURCE_GAP","budget":"MAXIMUM_BUDGET_UNAVAILABLE","conflict":"IDEMPOTENCY_CONFLICT"}[kind])
 if invalid or reasons: decision="abstain"
 elif kind in {"material","correction","backstop","risk","storm"}: decision="full_run"; reasons.append({"material":"MATERIAL_DELTA","correction":"CORRECTION","backstop":"MAXIMUM_STALENESS_BACKSTOP","risk":"RISK_OVERRIDE","storm":"EVENT_STORM"}[kind])
 else: decision="skip"; reasons.append("QUIET_DELTA")
 tier=item["tier"]; slots=routes(tier) if decision=="full_run" else ()
 maximum=sum(x["costMicrousd"] for x in slots); tokens=sum(x["inputTokens"]+x["outputTokens"] for x in slots)
 graph=[{"slotId":f"slot-{x['ordinal']:02d}","role":x["ordinal"],"route":x["route"]} for x in slots]
 root=digest({"item":item,"operator":operator,"request":request_hash,"context":binding,"decision":decision,"reasons":reasons,"slots":graph,"registry":registry_hash()})
 return {"decision":decision,"downstreamAction":{"skip":"record_skip","full_run":"retain_full_fixture_plan","abstain":"none"}[decision],"reasonCodes":reasons,"deltaClass":kind,"tier":tier,"baselineDecision":"full_run","obligationCount":len(obligations(tier)),"plannedSlotCount":len(graph),"slotGraph":graph,"expectedCalls":len(slots),"maximumCalls":len(slots),"expectedTokens":tokens,"maximumTokens":tokens,"expectedCredits":len(slots),"maximumCredits":len(slots),"expectedCostMicrousd":maximum,"maximumCostMicrousd":maximum,"creditsReserved":0,"providerCostMicrousd":0,"priorSnapshotRetained":decision=="skip","freshnessExtended":False,"selectedPrerequisiteStatus":"requires_revalidation","registryHash":registry_hash(),"rootHash":root,"invariantVerdict":"pass","fixtureOnly":True,"productOutcome":"unavailable","authorityEffect":"none","dispatchAvailable":False,"providerAttempts":0,"externalAttempts":0,"signerAttempts":0,"walletAttempts":0,"venueAttempts":0,"workflowAttempts":0,"actualProviderCalls":0}
