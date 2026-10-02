from __future__ import annotations
from importlib.resources import files
from .risk_tiered_consent_canonical import json_loads_strict,digest
def registry(): return json_loads_strict(files("moeazi_agent").joinpath("risk_tiered_consent_registry.json").read_text())
def registry_hash()->str: return digest(registry())
def source_ids()->tuple[str,...]: return tuple(registry()["sources"])
def field_directions()->dict[str,str]: return dict(registry()["fields"])
def tier_cap(tier:str)->int: return registry()["tierCaps"][tier]
