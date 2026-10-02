"""Closed inventory for local safety change simulation only."""
from __future__ import annotations
from importlib.resources import files
from .safety_change_quorum_canonical import digest, json_loads_strict

def raw() -> dict:
    value=json_loads_strict(files("moeazi_agent").joinpath("safety_change_quorum_registry.json").read_text("utf-8"))
    if set(value)!={"schemaVersion","registryVersion","limits","paths","prohibited"} or value["schemaVersion"]!=1: raise ValueError("safety quorum registry shape invalid")
    if value["limits"]!={"quorum":2,"requestMinutes":60,"approvalMinutes":30,"leaseMinutes":15,"nonceUses":1,"renewals":0,"chainId":42161}: raise ValueError("constitutional limits drift")
    if set(value["paths"]) != {"runtime.manual_guard.enabled","runtime.lite_mode.enabled","execution.live_execution.enabled","execution.mainnet_venue_setup.enabled","execution.certified_venues","risk.max_notional_native","delegation.allowed_actions","dependency.isolated","service_credential.active_version","safety.quorum_policy","safety.change_class_registry","safety.gate_implementation_hash"}: raise ValueError("mutation inventory closure invalid")
    if value["prohibited"] != {"productImports":True,"network":True,"signing":True,"redisTruth":True,"feature17TrustedQualification":True}: raise ValueError("prohibition drift")
    return value
def registry_hash() -> str: return digest(raw())
