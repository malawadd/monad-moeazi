"""Closed registry and synthetic corpus for Feature 30."""
from __future__ import annotations
from .evidence_integrity_canonical import digest
VERSION="2026-09-13.feature-30-local-v1"; FEATURE="manipulation-aware-evidence-integrity"
OPERATIONS=("freeze_integrity_fixture","resolve_source_identity","build_provenance_graph","cluster_independence","scan_injection","evaluate_claim_support","propagate_correction","issue_integrity_decision","replay","inspect")
KINDS=("benign","copy","ownership","injection","stale","rights","revoked","correction","opposing","lineage","unknown","overflow")
def scenarios(): return tuple({"id":f"evidence-integrity-{n:02d}","operation":"issue_integrity_decision","kind":KINDS[(n-1)%len(KINDS)],"claimClass":("regulatory_action","protocol_security_incident","corporate_financial_disclosure","venue_status","market_data","social_news_sentiment")[(n-1)%6]} for n in range(1,73))
def mutations(): return tuple(f"evidence-integrity-mutation-{n:03d}" for n in range(1,129))
def policy(claim_class):
 critical=claim_class!="social_news_sentiment"
 return {"critical":critical,"minimumClusters":2 if critical else 1,"maximumConfidenceBps":9000 if critical else 5500,"action":"block" if critical else "degrade"}
def registry_hash(): return digest({"version":VERSION,"feature":FEATURE,"operations":OPERATIONS,"scenarios":scenarios(),"mutations":mutations()})
def scenario(identifier):
 value=next((item for item in scenarios() if item["id"]==identifier),None)
 if not value: raise ValueError("evidence_integrity_scenario_unknown")
 return value
