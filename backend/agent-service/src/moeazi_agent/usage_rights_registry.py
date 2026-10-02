"""Closed registry for the local, non-authorizing rule evaluator."""
from __future__ import annotations
from functools import lru_cache
from importlib.resources import files
from .usage_rights_canonical import digest, json_loads_strict


@lru_cache(maxsize=1)
def raw() -> dict:
    value = json_loads_strict(files("moeazi_agent").joinpath("usage_rights_registry.json").read_text("utf-8"))
    required = {"schemaVersion", "registryVersion", "operations", "obligations", "precedence", "limits", "safeReasonCodes", "selfHash"}
    if set(value) != required or value["schemaVersion"] != 1 or value["registryVersion"] != "usage-rights-v1":
        raise ValueError("usage_rights_registry_shape_invalid")
    for key in ("operations", "obligations", "precedence", "safeReasonCodes"):
        if value[key] != sorted(set(value[key])) and key != "precedence":
            raise ValueError("usage_rights_registry_not_sorted_unique")
    if value["precedence"] != ["deny", "manual_legal_review_required", "unknown", "allow"]:
        raise ValueError("usage_rights_registry_precedence_invalid")
    if value["selfHash"] != digest({key: item for key, item in value.items() if key != "selfHash"}):
        raise ValueError("usage_rights_registry_hash_invalid")
    return value


def registry_hash() -> str: return raw()["selfHash"]
def operations() -> tuple[str, ...]: return tuple(raw()["operations"])
def obligations() -> tuple[str, ...]: return tuple(raw()["obligations"])
def limit(name: str) -> int: return raw()["limits"][name]
