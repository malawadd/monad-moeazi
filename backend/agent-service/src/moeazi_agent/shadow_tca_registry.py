"""Checked-in scenario registry; callers cannot choose simulator assumptions."""
from __future__ import annotations
from .shadow_tca_canonical import digest
_KINDS=("clob_ioc","clob_gtc","clob_alo","clob_gap","amm_fill","amm_expired","amm_revert","proxy","missing_cost","stale","calibration")
def scenarios():
 return [{"id":f"shadow-tca-{index:03d}","operation":"simulate_order_lifecycle","kind":kind,"family":"arbitrum_amm" if kind.startswith("amm") else "clob_perpetual"} for index,kind in enumerate(_KINDS,1)]
def scenario(identifier):
 item=next((value for value in scenarios() if value["id"]==identifier),None)
 if not item: raise ValueError("shadow_tca_unknown_scenario")
 return item
def registry_hash(): return digest({"version":"shadow-tca-v1","ttlSeconds":30,"scenarios":scenarios(),"calibration":"synthetic-only"})
def mutations(): return tuple(f"shadow-tca-mutation-{index:03d}" for index in range(1,257))
