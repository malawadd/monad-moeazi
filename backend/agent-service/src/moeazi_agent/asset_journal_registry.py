"""Closed local mapping rules for synthetic journal fixtures."""
from __future__ import annotations
import json
from importlib.resources import files
from .asset_journal_canonical import digest

def _pairs(items):
    value = {}
    for key, item in items:
        if key in value: raise ValueError("duplicate registry key")
        value[key] = item
    return value

def raw() -> dict:
    value = json.loads(files("moeazi_agent").joinpath("asset_journal_registry.json").read_text("utf-8"), object_pairs_hook=_pairs)
    expected = {"schemaVersion", "registryVersion", "eventClasses", "finality", "safeLanes", "prohibited"}
    if set(value) != expected or value["schemaVersion"] != 1: raise ValueError("journal registry shape invalid")
    if value["eventClasses"] != sorted(set(value["eventClasses"])) or value["safeLanes"] != sorted(set(value["safeLanes"])): raise ValueError("registry lists must be sorted")
    if value["prohibited"] != {"externalNetwork": True, "liveSubmit": True, "signing": True, "redisJournal": True}: raise ValueError("journal prohibition changed")
    return value

def registry_hash() -> str: return digest(raw())
