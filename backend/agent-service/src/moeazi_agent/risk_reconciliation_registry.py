"""Checked-in source rules for Feature 09; no product owners are consulted."""
from __future__ import annotations

import json
from importlib.resources import files

from .risk_reconciliation_canonical import digest


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result: raise ValueError("duplicate registry key")
        result[key] = value
    return result


def raw() -> dict:
    value = json.loads(files("moeazi_agent").joinpath("risk_reconciliation_registry.json").read_text("utf-8"), object_pairs_hook=_pairs)
    required = {"schemaVersion", "registryVersion", "snapshotTtlSeconds", "reservationTtlSeconds", "requiredSources", "sourceAuthorities", "safeLanes", "reasonCodes", "operations", "prohibited"}
    if set(value) != required or value["schemaVersion"] != 1: raise ValueError("risk registry shape invalid")
    for key in ("requiredSources", "safeLanes", "reasonCodes", "operations"):
        if value[key] != sorted(set(value[key])): raise ValueError("risk registry lists must be sorted")
    if value["requiredSources"] != ["analysis", "credit", "portfolio", "product", "quote", "reconciliation"]: raise ValueError("risk source closure changed")
    if set(value["sourceAuthorities"]) != set(value["requiredSources"]) or any(
            set(item) != {"ownerKind", "revision"} for item in value["sourceAuthorities"].values()):
        raise ValueError("risk source authorities are incomplete")
    if value["prohibited"] != {"externalNetwork": True, "liveSubmit": True, "signing": True}: raise ValueError("risk prohibition changed")
    return value


def registry_hash() -> str: return digest(raw())
