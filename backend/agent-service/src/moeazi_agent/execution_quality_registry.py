"""Finite routing fixture registry; it is not the product routing configuration."""
from .execution_quality_canonical import digest
VERSION="2026-09-15.feature-32-local-v1"; FEATURE="multi-venue-execution-quality-routing"
OPERATIONS=("freeze_route_subject","validate_quote_evidence","fold_book_state","evaluate_candidate","compare_routes","select_submission_channel_fixture","issue_route_plan","revalidate_preflight_fixture","record_lifecycle_receipt","compare_baseline","replay","inspect")
KINDS=("clean","stale","gap","indicative","cost","health","reconciliation","depth","channel","uncertain","tie","scope")
def scenarios(): return tuple({"id":f"execution-quality-{n:03d}","operation":"compare_routes","kind":KINDS[(n-1)%len(KINDS)]} for n in range(1,97))
def mutations(): return tuple(f"execution-quality-mutation-{n:03d}" for n in range(1,257))
def registry_hash(): return digest({"version":VERSION,"feature":FEATURE,"operations":OPERATIONS,"scenarios":scenarios(),"mutations":mutations(),"sourceClasses":("exact_executable","exact_public","indicative","proxy")})
def scenario(identifier):
 value=next((item for item in scenarios() if item["id"]==identifier),None)
 if not value: raise ValueError("execution_quality_scenario_unknown")
 return value
