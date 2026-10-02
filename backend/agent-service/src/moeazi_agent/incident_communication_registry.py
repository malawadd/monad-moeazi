"""Closed registry for deterministic local in-app communication simulation."""
from __future__ import annotations
from importlib.resources import files
from .incident_communication_canonical import digest, json_loads_strict

def raw() -> dict:
    value=json_loads_strict(files("moeazi_agent").joinpath("incident_communication_registry.json").read_text("utf-8"))
    keys={"schemaVersion","registryVersion","policies","channels","audienceRoles","templates","reasons","prohibited"}
    if set(value)!=keys or value["schemaVersion"]!=1: raise ValueError("incident communication registry shape invalid")
    for key in ("policies","channels","audienceRoles","templates","reasons"):
        if value[key]!=sorted(set(value[key])): raise ValueError("incident communication registry set invalid")
    expected={"externalNetwork":True,"externalChannels":True,"providerRpc":True,"llmCopy":True,"liveExecution":True,"signing":True,"convexWrites":True,"temporalWrites":True,"redisDurability":True}
    if value["prohibited"]!=expected or value["channels"] != ["in_app"]: raise ValueError("incident communication prohibition drift")
    return value

def registry_hash() -> str: return digest(raw())
