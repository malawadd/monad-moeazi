"""Conservative integer-only sizing reducer; it creates no proposal or venue request."""
from __future__ import annotations
from .portfolio_sizing_canonical import digest,floor_div
from .portfolio_sizing_registry import registry_hash,scenario
def evaluate(identifier,mode,operator,request_hash,context):
 if mode not in {"observe","enforce"}: raise ValueError("portfolio_sizing_mode")
 item=scenario(identifier); kind=item["kind"]; reasons=[]
 if not context or context.get("trustStatus")!="requires_revalidation": reasons.append("FEATURE09_BINDING_INVALID")
 if kind=="stale": reasons.append("STALE_INPUT")
 if kind=="disputed": reasons.append("DISPUTED_INPUT")
 if kind=="reconciliation": reasons.append("RECONCILIATION_INCOMPLETE")
 if kind=="emergency": reasons.append("EMERGENCY_STOP")
 if kind=="scope": reasons.append("SCOPE_MISMATCH")
 base=25_000; cap=base
 if kind=="clamp": cap=12_000
 if kind=="volatility": cap=floor_div(base,4)
 if kind=="liquidity": cap=floor_div(base,5)
 if kind=="cost": cap=0; reasons.append("NET_BENEFIT_HURDLE")
 if kind=="forecast": cap=floor_div(base,2); reasons.append("UNCALIBRATED_FORECAST_HAIRCUT")
 if kind=="minimum": cap=500; reasons.append("BELOW_MINIMUM_NOTIONAL")
 if reasons and kind not in {"clamp","volatility","liquidity","forecast"}: cap=0
 decision="abstain" if cap<=0 else "clamped" if cap<base else "approve_for_routing"
 if decision=="abstain" and not reasons: reasons.append("NO_FEASIBLE_CAPACITY")
 quantity=floor_div(cap,100) if cap else 0
 root=digest({"scenario":item,"operator":operator,"request":request_hash,"context":context,"registry":registry_hash(),"decision":decision,"notional":cap,"quantity":quantity,"reasons":sorted(reasons)})
 return {"scenario":item,"decision":decision,"wouldDecision":decision,"approvedNotional":cap,"approvedLeverage":1 if cap else 0,"quantity":quantity,"coherenceState":"keep" if cap else "abstain","reservationState":"not_requested" if mode=="observe" or not cap else "synthetic_reserved","bindingConstraints":sorted(reasons),"stressWorstCase":"bounded_fixture","baselineNotional":25_000,"candidateNotional":cap,"rootHash":root,"registryHash":registry_hash(),"contextHash":context.get("contextHash","fixture"),"selectedPrerequisiteStatus":"requires_revalidation","invariantVerdict":"pass","fixtureOnly":True,"productOutcome":"unavailable","authorityEffect":"none","providerAttempts":0,"externalAttempts":0,"signerAttempts":0,"walletAttempts":0,"venueAttempts":0,"providerCost":0}
