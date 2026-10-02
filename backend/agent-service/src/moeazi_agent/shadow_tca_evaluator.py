"""Deterministic, exact-integer fixture-only CLOB and AMM Shadow/TCA evaluator."""
from __future__ import annotations
from .shadow_tca_canonical import digest,ceil_div
from .shadow_tca_registry import scenario,registry_hash
def _abstain(kind,reason): return kind in {"clob_gap","proxy","missing_cost","stale"} or reason
def evaluate(identifier,mode,operator,request_hash,context):
 if mode not in {"observe","enforce"}: raise ValueError("shadow_tca_mode")
 item=scenario(identifier);kind=item["kind"]; binding=context or {}; invalid=binding.get("trustStatus")!="requires_revalidation" or binding.get("decision") not in {"hypothetical_route","abstain_no_synthetic_route"} or binding.get("zeroAttempts") is not True
 family=item["family"]; quantity=1000; capacity=600 if kind in {"clob_ioc","clob_gtc","clob_alo"} else 1000
 stale=kind=="stale"; proxy=kind=="proxy"; missing_cost=kind=="missing_cost"; rejected=kind in {"amm_revert","amm_expired"}; gap=kind=="clob_gap"
 filled=0 if invalid or stale or proxy or missing_cost or gap or rejected else min(quantity,capacity)
 residual=quantity-filled; terminal="rejected" if rejected else "unknown" if invalid or stale or proxy or missing_cost or gap else "filled" if not residual else "cancelled"
 observability="proxy_indicative" if proxy else "sequence_complete_replay" if family=="clob_perpetual" else "depth_approximation"
 cost_complete=not missing_cost and not invalid and not proxy and not stale and not gap
 fee=125 if cost_complete else None; gas=75 if family=="arbitrum_amm" and cost_complete else 0 if cost_complete else None; impact=ceil_div(filled,10) if cost_complete else None
 total=fee+gas+impact if cost_complete else None
 unscorable=_abstain(kind,invalid) or not cost_complete
 reason=[]
 if invalid: reason.append("FEATURE32_BINDING_INVALID")
 if stale: reason.append("STALE_SNAPSHOT")
 if proxy: reason.append("PROXY_INPUT")
 if gap: reason.append("CAUSAL_GAP")
 if missing_cost: reason.append("COST_INCOMPLETE")
 if rejected: reason.append("AMM_REJECT_OR_EXPIRE")
 decision="research_only" if kind=="calibration" and not unscorable else "insufficient" if unscorable else "research_only"
 root=digest({"scenario":item,"operator":operator,"request":request_hash,"binding":binding,"registry":registry_hash(),"filled":filled,"residual":residual,"terminal":terminal,"cost":total,"reasons":reason})
 return {"scenario":item,"semanticFamily":family,"observability":observability,"terminalState":terminal,"filledQuantity":filled,"filledLowerQuantity":filled,"filledUpperQuantity":quantity if terminal in {"cancelled","unknown"} else filled,"residualQuantity":residual,"costCompleteness":"complete" if cost_complete else "unknown","costComponents":{"feeMicrousd":fee,"impactMicrousd":impact,"fundingMicrousd":0 if cost_complete else None,"gasMicrousd":gas},"totalCostMicrousd":total,"baseline":"legacy_quote_full_fill_fixture","baselineFilledQuantity":quantity,"baselineOptimismMicrousd":(total or 0)+residual,"tcaResidualMicrousd":None,"calibrationDecision":decision,"calibrationSampleClass":"synthetic_zero_certified_actual","certifiedActualCount":0,"reasonCodes":reason,"assumptionCodes":["FIXTURE_ONLY","FEATURE32_REQUIRES_REVALIDATION"],"eventCount":2 if filled else 1,"rootHash":root,"registryHash":registry_hash(),"contextHash":binding.get("contextHash","fixture"),"selectedPrerequisiteStatus":"requires_revalidation","invariantVerdict":"pass","fixtureOnly":True,"productOutcome":"unavailable","authorityEffect":"none","providerAttempts":0,"externalAttempts":0,"signerAttempts":0,"walletAttempts":0,"venueAttempts":0,"providerCost":0,"maximumCalls":0,"actualProviderCalls":0,"elapsedMicros":0,"_artifacts":{"rootHash":root,"registryHash":registry_hash()}}
