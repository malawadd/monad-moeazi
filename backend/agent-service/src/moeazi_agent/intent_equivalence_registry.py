"""Closed decoder/fixture registry; it deliberately has no network configuration."""
from __future__ import annotations
from importlib.resources import files
from .intent_equivalence_canonical import digest, json_loads_strict

def raw() -> dict:
    value = json_loads_strict(files("moeazi_agent").joinpath("intent_equivalence_registry.json").read_text("utf-8"))
    expected = {"schemaVersion", "registryVersion", "artifactBytes", "decodedNodes", "commands", "depth", "stateDeltas", "gas", "receiptTtlSeconds", "operations", "prohibited"}
    if set(value) != expected or value["schemaVersion"] != 1: raise ValueError("intent registry shape invalid")
    if value["operations"] != sorted(set(value["operations"])): raise ValueError("intent registry operations invalid")
    if value["prohibited"] != {"externalNetwork": True, "liveSubmit": True, "signing": True, "providerRpc": True, "redisReceipts": True}: raise ValueError("intent registry prohibition changed")
    return value

def registry_hash() -> str: return digest(raw())
