"""Finite paired, integer-only local source-family ablation estimates."""
from __future__ import annotations
from .source_value_result_contracts import FamilyContributionEstimate,ContractCandidateDecision
def estimate(family:str, observations:tuple[tuple[int,int],...], objective="grounding"):
 deltas=tuple(a-b for a,b in observations)
 count=len(deltas)
 if count<100: return FamilyContributionEstimate(family,objective,0,0,0,count,"inconclusive")
 ordered=sorted(deltas); value=sum(deltas)//count
 return FamilyContributionEstimate(family,objective,value,ordered[max(0,count//20-1)],ordered[min(count-1,count*19//20)],count,"estimated")
def candidate(estimate:FamilyContributionEstimate, rare_risk=False):
 if rare_risk or estimate.state!="estimated": return ContractCandidateDecision("retain" if rare_risk else "inconclusive")
 return ContractCandidateDecision("shadow_candidate" if estimate.upper_bps<=0 else "retain")
