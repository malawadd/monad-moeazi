"""Closed self-hashed registry for the non-authorizing local projector."""
from __future__ import annotations
from functools import lru_cache
from importlib.resources import files
from .effective_authority_canonical import digest, json_loads_strict
@lru_cache(maxsize=1)
def raw() -> dict:
    value=json_loads_strict(files("moeazi_agent").joinpath("effective_authority_registry.json").read_text("utf-8"))
    if set(value)!={"schemaVersion","registryVersion","gates","selfHash"} or value["schemaVersion"] != 1 or value["registryVersion"] != "effective-authority-v1": raise ValueError("authority_registry_shape_invalid")
    gates=value["gates"]
    keys={"id","category","owner","sourceType","sourceVersion","applicable","freshnessSeconds","ceiling","fallback","rank","required","reason","remediation","redaction","prerequisites"}; ids={item["id"] for item in gates}; caps={"ANALYZE_ONLY","SHADOW_SIMULATE","PREFLIGHT_ONLY","SUBMISSION_ELIGIBLE"}
    if not isinstance(gates,list) or len(ids)!=len(gates) or [item["rank"] for item in gates] != sorted(item["rank"] for item in gates) or any(set(item)!=keys or item["sourceVersion"]!="fixture-v1" or item["ceiling"] not in caps or item["fallback"] not in caps or item["redaction"]!="safe" or not item["applicable"] or not set(item["prerequisites"]).issubset(ids) for item in gates): raise ValueError("authority_registry_gates_invalid")
    if value["selfHash"] != digest({key:item for key,item in value.items() if key!="selfHash"}): raise ValueError("authority_registry_hash_invalid")
    return value
def registry_hash() -> str: return raw()["selfHash"]
def required_gate_ids() -> tuple[str,...]: return tuple(item["id"] for item in raw()["gates"] if item["required"])
def rank(gate_id:str)->int: return next(item["rank"] for item in raw()["gates"] if item["id"]==gate_id)
def gate(gate_id:str)->dict|None: return next((item for item in raw()["gates"] if item["id"]==gate_id),None)
def applicable(action:str)->tuple[dict,...]: return tuple(item for item in raw()["gates"] if action in item["applicable"] and item["required"])
