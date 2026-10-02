"""Closed registry for Feature 13's checked-in synthetic corpus."""
from __future__ import annotations
from importlib.resources import files
from .collateral_resilience_canonical import digest, strict_loads

def raw() -> dict:
    value = strict_loads(files("moeazi_agent").joinpath("collateral_resilience_registry.json").read_text("utf-8"))
    expected = {"schemaVersion", "registryVersion", "operations", "increaseOperations", "safeLanes", "reasonCodes", "prohibited"}
    if set(value) != expected or value["schemaVersion"] != 1: raise ValueError("collateral registry shape invalid")
    for key in ("operations", "increaseOperations", "safeLanes", "reasonCodes"):
        if value[key] != sorted(set(value[key])): raise ValueError(f"registry {key} must be closed and sorted")
    if not set(value["increaseOperations"]).issubset(value["operations"]): raise ValueError("increase operation unknown")
    if value["prohibited"] != {"externalNetwork": True, "liveExecution": True, "providerRpc": True, "signing": True, "redisReceipts": True}: raise ValueError("collateral prohibition changed")
    return value

def registry_hash() -> str: return digest(raw())
