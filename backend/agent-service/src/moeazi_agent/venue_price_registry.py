"""Closed registry loader for the isolated venue-price corpus."""
from __future__ import annotations
from importlib.resources import files
from .venue_price_canonical import digest, strict_loads


def raw() -> dict:
    value = strict_loads(files("moeazi_agent").joinpath("venue_price_registry.json").read_text("utf-8"))
    expected = {"schemaVersion", "registryVersion", "operations", "requiredRoles", "safeLanes", "reasonCodes", "prohibited"}
    if set(value) != expected or value["schemaVersion"] != 1: raise ValueError("venue price registry shape invalid")
    for key in ("operations", "requiredRoles", "safeLanes", "reasonCodes"):
        if value[key] != sorted(set(value[key])): raise ValueError(f"registry {key} invalid")
    if value["prohibited"] != {"externalNetwork": True, "liveExecution": True, "providerRpc": True, "signing": True, "redisReceipts": True}:
        raise ValueError("venue price prohibition changed")
    return value


def registry_hash() -> str: return digest(raw())
