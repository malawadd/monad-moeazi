"""Closed Feature 31 fixture corpus registry."""
from .portfolio_sizing_canonical import digest
VERSION="2026-09-14.feature-31-local-v1"; FEATURE="portfolio-aware-sizing"
OPERATIONS=("freeze_sizing_subject","validate_portfolio","estimate_market_risk","evaluate_coherence","compute_capacities","run_stress_matrix","size_intent","construct_inert_trade","reserve_fixture_capacity","compare_baseline","replay","inspect")
KINDS=("clean","clamp","minimum","stale","disputed","volatility","liquidity","cost","reconciliation","forecast","emergency","scope")
def scenarios(): return tuple({"id":f"portfolio-sizing-{n:03d}","operation":"size_intent","kind":KINDS[(n-1)%len(KINDS)]} for n in range(1,97))
def mutations(): return tuple(f"portfolio-sizing-mutation-{n:03d}" for n in range(1,257))
def registry_hash(): return digest({"version":VERSION,"feature":FEATURE,"operations":OPERATIONS,"scenarios":scenarios(),"mutations":mutations()})
def scenario(identifier):
 value=next((item for item in scenarios() if item["id"]==identifier),None)
 if not value: raise ValueError("portfolio_sizing_scenario_unknown")
 return value
