"""Closed, local-only termination registry."""
from __future__ import annotations
from importlib.resources import files
from .strategy_termination_canonical import digest, json_loads_strict

def raw() -> dict:
    value = json_loads_strict(files("moeazi_agent").joinpath("strategy_termination_registry.json").read_text("utf-8"))
    expected = {"schemaVersion", "registryVersion", "operations", "prohibited", "categories", "terminalDispositions"}
    if set(value) != expected or value["schemaVersion"] != 1: raise ValueError("termination registry shape invalid")
    for name in ("operations", "categories", "terminalDispositions"):
        if value[name] != sorted(set(value[name])): raise ValueError("termination registry set invalid")
    if value["prohibited"] != {"externalNetwork": True, "liveSubmit": True, "signing": True, "providerRpc": True, "redisDurability": True}:
        raise ValueError("termination registry prohibition changed")
    return value

def registry_hash() -> str: return digest(raw())
