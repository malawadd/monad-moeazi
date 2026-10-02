"""Safe projections from the local, synthetic disagreement graph."""
from __future__ import annotations
from dataclasses import dataclass,field
from .claim_disagreement_canonical import digest
@dataclass(frozen=True)
class ConflictGroup:
 key:tuple[str,...]; members:tuple[str,...]; material:bool; reasons:tuple[str,...]; group_hash:str=field(init=False)
 def __post_init__(self): object.__setattr__(self,"group_hash",digest({"key":self.key,"members":self.members,"material":self.material,"reasons":self.reasons}))
@dataclass(frozen=True)
class EscalationDecision:
 route:str; reserved_calls:int; actual_calls:int; reserved_tokens:int; actual_tokens:int; reserved_cost_microusd:int; actual_cost_microusd:int; reason:str
 def __post_init__(self):
  if min(self.reserved_calls,self.actual_calls,self.reserved_tokens,self.actual_tokens,self.reserved_cost_microusd,self.actual_cost_microusd)<0 or self.actual_calls>self.reserved_calls or self.actual_tokens>self.reserved_tokens or self.actual_cost_microusd>self.reserved_cost_microusd: raise ValueError("ledger_reservation")
def projection(graph):
 decision=graph["decision"]
 return {"baseline":"frozen-tier-topology","candidate":"claim-disagreement-ledger","validClaimCount":graph["valid"],"invalidClaimCount":graph["invalid"],"groupCount":len(graph["groups"]),"materialGroupCount":sum(x.material for x in graph["groups"]),"unresolvedCount":graph["unresolved"],"criticalRecallBps":graph["recall"],"criticalPrecisionBps":graph["precision"],"familyDiversity":graph["families"],"routeChosen":decision.route,"baselineCalls":graph["baselineCalls"],"maximumCalls":decision.reserved_calls,"actualCalls":decision.actual_calls,"reservedTokens":decision.reserved_tokens,"actualTokens":decision.actual_tokens,"reservedCostMicrousd":decision.reserved_cost_microusd,"actualCostMicrousd":decision.actual_cost_microusd,"wouldAbstain":graph["wouldAbstain"],"resolutionStatus":"abstain" if graph["wouldAbstain"] else "resolved","reasons":list(graph["reasons"]),"selectedPrerequisiteStatus":"requires_revalidation","researchStatus":"hold","humanAdjudication":False,"fixtureOnly":True,"productOutcome":"unavailable","authorityEffect":"none","externalAttempts":0,"providerAttempts":0,"providerCost":0,"signerAttempts":0,"walletAttempts":0,"venueAttempts":0,"rootHash":graph["rootHash"][:12],"invariantVerdict":"blocked" if graph["wouldAbstain"] and graph["mode"]=="enforce" else "pass"}
