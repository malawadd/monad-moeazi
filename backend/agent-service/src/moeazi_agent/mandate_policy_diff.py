"""Exhaustive, registry-owned semantic change classification."""
from __future__ import annotations
from .mandate_policy_canonical import digest
from .mandate_policy_registry import raw

def _direction(field: str, before, after) -> str:
    if before == after: return "neutral"
    meta = raw()["fields"].get(field)
    if not meta: return "unknown"
    kind = meta["kind"]
    if kind == "set" and (not isinstance(before,(tuple,list)) or not isinstance(after,(tuple,list))): return "unknown"
    if kind in {"max","min","time"} and (not isinstance(before,int) or isinstance(before,bool) or not isinstance(after,int) or isinstance(after,bool)): return "unknown"
    if kind == "required" and (not isinstance(before,bool) or not isinstance(after,bool)): return "unknown"
    if kind == "set":
        added, removed = set(after)-set(before), set(before)-set(after)
        return "mixed" if added and removed else "loosening" if added else "tightening"
    if kind == "required": return "loosening" if before and not after else "tightening"
    if kind == "cadence":
        rank={"on_demand":0,"daily":1,"hourly":2}; return "loosening" if rank[after]>rank[before] else "tightening"
    if kind == "time":
        earlier = meta["direction"] == "earlier_loosen"; return "loosening" if (after < before) == earlier else "tightening"
    if kind == "max": return "loosening" if after > before else "tightening"
    if kind == "min": return "loosening" if after < before else "tightening"
    return "unknown"

def semantic_diff(before: dict | None, after: dict, *, registry_hash_value: str | None = None, compiler_match: bool = True) -> dict:
    if registry_hash_value is not None and registry_hash_value != raw().get("selfHash"): compiler_match=False
    if before is None:
        items=[{"field":field,"direction":"loosening","reasonCode":"initial_authority_expansion"} for field in sorted(after)]
    else:
        fields=sorted(set(before)|set(after)); items=[]
        for field in fields:
            direction="unknown" if not compiler_match or field not in before or field not in after else _direction(field,before[field],after[field])
            items.append({"field":field,"direction":direction,"reasonCode":f"field_{direction}"})
    directions={item["direction"] for item in items}
    aggregate="unknown" if "unknown" in directions else "mixed" if "mixed" in directions or ({"loosening","tightening"} <= directions) else "contains_loosening" if "loosening" in directions else "tightening_only" if "tightening" in directions else "no_change"
    return {"items":items,"aggregate":aggregate,"diffHash":digest(items)}
