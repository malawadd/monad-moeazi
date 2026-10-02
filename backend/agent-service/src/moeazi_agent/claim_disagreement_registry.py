"""Closed fixture resources and immutable routing vocabulary."""
from __future__ import annotations
import json
from importlib.resources import files
from .claim_disagreement_canonical import digest
VERSION="2026-09-12.feature-28-local-v1"; FEATURE="claim-disagreement-ledger"
OPERATIONS=("freeze_subject","validate_claims","group_claims","detect_conflicts","assess_materiality","build_packet","simulate_escalation","record_resolution","compare_subjects","replay","inspect")
PACKS=tuple(f"ledger-pack-{x:02d}" for x in range(1,7))
def load(name): return json.loads(files("moeazi_agent").joinpath(name).read_text(encoding="utf-8"))
def corpus():
 data=load("claim_disagreement_registry.json")
 if len(data["scenarios"])<48 or len(data["mutations"])<96: raise ValueError("ledger_corpus_closure")
 return data
def registry_hash(): return digest({"version":VERSION,"feature":FEATURE,"operations":OPERATIONS,"corpus":digest(corpus())})
def scenario(name):
 value=next((x for x in corpus()["scenarios"] if x["id"]==name),None)
 if not value: raise ValueError("ledger_scenario_unknown")
 return value
def pack(name):
 if name not in PACKS: raise ValueError("ledger_pack_unknown")
 return tuple(x for x in corpus()["scenarios"] if x["pack"]==name)
