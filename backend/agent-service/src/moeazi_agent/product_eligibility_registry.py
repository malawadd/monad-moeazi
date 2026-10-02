"""Closed dimensions; no external law or KYC source is consulted."""
from functools import lru_cache
from importlib.resources import files
from .product_eligibility_canonical import digest,json_loads_strict
@lru_cache(maxsize=1)
def raw():
    value=json_loads_strict(files("moeazi_agent").joinpath("product_eligibility_registry.json").read_text("utf-8"))
    required={"schemaVersion","registryVersion","jurisdictionRoles","customerClasses","customerKeys","productClasses","venues","operations","outcomes","reasonCodes","limits","selfHash"}
    if set(value)!=required or value["registryVersion"]!="product-eligibility-v1": raise ValueError("product_eligibility_registry_shape_invalid")
    if any(value[k]!=sorted(set(value[k])) for k in required-{"schemaVersion","registryVersion","limits","selfHash"}): raise ValueError("product_eligibility_registry_order_invalid")
    if value["selfHash"]!=digest({k:v for k,v in value.items() if k!="selfHash"}): raise ValueError("product_eligibility_registry_hash_invalid")
    return value
def registry_hash(): return raw()["selfHash"]
def members(name): return tuple(raw()[name])
def limit(name): return raw()["limits"][name]
