"""Closed registry loader. Missing fields or a tampered registry fail closed."""
from __future__ import annotations
from functools import lru_cache
from importlib.resources import files
from .mandate_policy_canonical import digest, json_loads_strict

POLICY_FIELDS = (
    "allowedMarkets", "allowedVenues", "maxOrderUsd", "maxDailyVolumeUsd", "maxLeverage",
    "maxExposureUsd", "maxDailyLossUsd", "maxDailyDrawdownPct", "maxSlippageBps",
    "maxAnalysisAgeMs", "minConfidence", "minConsensus", "cooldownSeconds",
    "maxConcurrentPositions", "requireStopLoss", "requireTakeProfit", "dailyCreditBudget",
)
PROFILE_FIELDS = ("allowedAuthorityModes", "cadence", "approvalRequired")
SCOPE_FIELDS = ("effectiveAt", "expiresAt")

@lru_cache(maxsize=1)
def raw() -> dict:
    data = json_loads_strict(files("moeazi_agent").joinpath("mandate_policy_registry.json").read_text("utf-8"))
    required = set(POLICY_FIELDS + PROFILE_FIELDS + SCOPE_FIELDS)
    bounds=data.get("bounds",{}); numeric={field for field,meta in data.get("fields",{}).items() if meta.get("kind") in {"min","max"}}
    if set(data.get("fields", {})) != required or set(bounds)!=numeric|set(SCOPE_FIELDS) or data.get("chainId") != 42161 or data.get("cadences") != ["on_demand","hourly","daily"] or data.get("testCases") != ["lower","equal","upper","allow","deny","protective","profile","time","chain"]:
        raise ValueError("registry_closure_invalid")
    if any(not isinstance(limit,list) or len(limit)!=2 or not all(isinstance(value,int) for value in limit) or limit[0]>limit[1] for limit in bounds.values()): raise ValueError("registry_bounds_invalid")
    expected = digest({key: value for key, value in data.items() if key != "selfHash"})
    if data.get("selfHash") != expected:
        raise ValueError("registry_self_hash_invalid")
    return data

def registry_hash() -> str:
    return raw()["selfHash"]

def defaults() -> dict:
    return {field: raw()["fields"][field]["default"] for field in raw()["fields"]}
