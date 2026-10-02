"""Monotonic local reducer: clustering and quarantine only reduce eligibility."""
from __future__ import annotations
from .evidence_integrity_canonical import digest
from .evidence_integrity_registry import policy,registry_hash,scenario

def evaluate(identifier,mode,operator,request_hash,context):
 if mode not in {"observe","enforce"}: raise ValueError("evidence_integrity_mode")
 item=scenario(identifier); spec=policy(item["claimClass"]); kind=item["kind"]
 quarantined=kind=="injection"; clustered=1 if kind in {"copy","ownership","lineage","unknown"} else 2
 reasons=[]
 if quarantined: reasons.append("INJECTION_QUARANTINE")
 if kind in {"stale","rights","revoked","unknown","lineage"}: reasons.append({"stale":"STALE_REQUIRED_EVIDENCE","rights":"RIGHTS_UNUSABLE","revoked":"SOURCE_REVOKED","unknown":"INDEPENDENCE_UNKNOWN","lineage":"LINEAGE_INCOMPLETE"}[kind])
 if kind=="correction": reasons.append("CORRECTION_RECHECK_REQUIRED")
 if kind=="overflow": reasons.append("IMPACT_BUDGET_EXCEEDED")
 if clustered<spec["minimumClusters"]: reasons.append("INDEPENDENT_CORROBORATION_INSUFFICIENT")
 blocked=bool(reasons) and spec["critical"]
 decision="block" if blocked else "degrade" if reasons else "allow"
 cap=0 if blocked else min(spec["maximumConfidenceBps"],5500 if reasons else spec["maximumConfidenceBps"])
 unsafe_clusters=3 if kind in {"copy","ownership","lineage","unknown"} else clustered
 root=digest({"scenario":item,"operator":operator,"request":request_hash,"context":context,"registry":registry_hash(),"clusters":clustered,"decision":decision,"reasons":sorted(reasons),"cap":cap})
 impact="requires_revalidation" if kind=="correction" else "affected_history" if kind=="revoked" else "none"
 return {"scenario":item,"decision":decision,"wouldDecision":decision,"confidenceCapBps":cap,"independentClusters":clustered,"unsafeBaselineClusters":unsafe_clusters,"quarantinedCount":int(quarantined),"excludedCount":int(quarantined),"primaryEvidenceCount":1,"opposingEvidenceCount":int(kind=="opposing"),"impactState":impact,"impactedArtifactCount":1 if impact!="none" else 0,"reasons":sorted(reasons),"rootHash":root,"registryHash":registry_hash(),"contextHash":context.get("contextHash","fixture"),"invariantVerdict":"pass","fixtureOnly":True,"productOutcome":"unavailable","authorityEffect":"none","providerAttempts":0,"externalAttempts":0,"signerAttempts":0,"walletAttempts":0,"venueAttempts":0,"providerCost":0}
