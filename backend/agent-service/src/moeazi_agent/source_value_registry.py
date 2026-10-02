"""Closed local corpus and source-family/role contracts."""
from __future__ import annotations
from .source_value_canonical import digest
from .source_value_definition_contracts import FAMILIES,RoleEvidenceContract
VERSION="2026-09-12.feature-29-local-v1"; FEATURE="specialist-source-value-attribution"
OPERATIONS=("freeze_manifest","resolve_citations","evaluate_role_contract","freeze_ablation_plan","replay_paired_cases","estimate_family_value","compare_contracts","record_candidate","replay","inspect")
ROLES=("market_analyst","risk_analyst","technical_analyst","news_analyst")
def contracts():
 return tuple(RoleEvidenceContract(role,"intraday",("exact_venue_price_ohlc",),("primary_curated_news",),("unverified_social",),("liquidation_data",),role=="risk_analyst") for role in ROLES)
def scenarios(): return tuple({"id":f"source-value-{n:02d}","role":ROLES[(n-1)%len(ROLES)],"tier":("Lite","Focus","Pro","Max")[(n-1)%4],"kind":("eligible","unknown","duplicate","cross_scope","stale","forbidden","rare_risk","underpowered")[(n-1)%8]} for n in range(1,65))
def mutations(): return tuple(f"source-value-mutation-{n:03d}" for n in range(1,129))
def registry_hash(): return digest({"version":VERSION,"feature":FEATURE,"operations":OPERATIONS,"families":FAMILIES,"scenarios":scenarios(),"mutations":mutations()})
def scenario(identifier):
 value=next((item for item in scenarios() if item["id"]==identifier),None)
 if not value: raise ValueError("source_value_scenario_unknown")
 return value
