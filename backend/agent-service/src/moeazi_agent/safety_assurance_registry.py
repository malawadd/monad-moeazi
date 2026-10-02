"""Resource registry for the fixed local assurance corpus."""
from __future__ import annotations
import json
from hashlib import sha256
from importlib.resources import files
from .safety_assurance_canonical import digest
VERSION="2026-09-11.feature-27-local-v1"; FEATURE="system-safety-assurance-corpus"
OPERATIONS=("inventory_claims","freeze_corpus","run_pack","apply_mutations","adjudicate_fixture","build_coverage","issue_verdict","replay","inspect")
PACKS=("assurance-pack-01","assurance-pack-02","assurance-pack-03","assurance-pack-04","assurance-pack-05")
def load(name): return json.loads(files("moeazi_agent").joinpath(name).read_text(encoding="utf-8"))
def corpus():
 data=load("safety_assurance_registry.json")
 if len(data["claims"])!=8 or len(data["cases"])!=40 or len(data["mutations"])!=96: raise ValueError("assurance_corpus_closure_invalid")
 return data
def corpus_hash(): return digest(corpus())
def registry_hash(): return digest({"version":VERSION,"feature":FEATURE,"operations":OPERATIONS,"packs":PACKS,"corpus":corpus_hash()})
def pack(name):
 if name not in PACKS: raise ValueError("assurance_pack_unregistered")
 return tuple(x for x in corpus()["cases"] if x["packId"]==name)
def source_root():
 names=("safety_assurance_registry.json","safety_assurance_expectations.json","safety_assurance_goldens.json")
 return digest({name:sha256(files("moeazi_agent").joinpath(name).read_bytes()).hexdigest() for name in names})
