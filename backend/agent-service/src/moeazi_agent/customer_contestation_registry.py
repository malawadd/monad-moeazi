"""Closed vocabulary for Feature 23; values are fixture policy, not legal terms."""
from functools import lru_cache
from importlib.resources import files
from .customer_contestation_canonical import digest,json_loads_strict
@lru_cache(maxsize=1)
def registry(): return json_loads_strict(files("moeazi_agent").joinpath("customer_contestation_registry.json").read_text("utf-8"))
def members(key): return tuple(registry()[key])
def limit(key): return registry()[key]
def registry_hash(): return digest(registry())
