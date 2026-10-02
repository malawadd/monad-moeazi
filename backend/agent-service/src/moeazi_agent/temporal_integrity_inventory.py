"""Static closure checker for the Feature 06 comparison inventory."""
from __future__ import annotations
import json
from pathlib import Path
from importlib.resources import files
from .temporal_integrity_contracts import digest
from .temporal_integrity_registry import specs

def inventory() -> dict: return json.loads(files("moeazi_agent").joinpath("temporal_integrity_gate_inventory.json").read_text())
def inventory_hash() -> str: return digest(inventory())
def verify_inventory() -> None:
    values = inventory(); domains = specs()
    entries = values.get("entries", [])
    if not entries or any(item.get("status") not in {"inventoried_unwired", "local_fixture_covered"} or item.get("domain") not in domains for item in entries):
        raise ValueError("temporal gate inventory is not closed")
    keys = [(item.get("path"), item.get("symbol")) for item in entries]
    if len(keys) != len(set(keys)):
        raise ValueError("temporal gate inventory has duplicate identities")
    root = Path(__file__).resolve().parents[3]
    for item in entries:
        path = root / item["path"]
        if not path.is_file():
            raise ValueError("temporal gate inventory references a missing path")
        if item.get("clockExpression") not in path.read_text(encoding="utf-8"):
            raise ValueError("temporal gate inventory clock expression is missing")
