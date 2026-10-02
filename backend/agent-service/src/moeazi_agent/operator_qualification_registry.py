"""Closed local policy registry. Drift blocks a fixture rather than broadening it."""
from __future__ import annotations
from importlib.resources import files
from .operator_qualification_canonical import digest, json_loads_strict

_KEYS={"schemaVersion","registryVersion","environments","identityTrust","roles","modules","drills","rubrics","fakeAdapters","consumers","accommodation","limits","policyHash","selfHash"}
def raw() -> dict:
    value=json_loads_strict(files("moeazi_agent").joinpath("operator_qualification_registry.json").read_text("utf-8"))
    if set(value)!=_KEYS or value["schemaVersion"]!=1 or value["environments"] != ["local","test"] or value["identityTrust"]!="synthetic_untrusted": raise ValueError("operator qualification registry shape invalid")
    if list(value["roles"]) != sorted(value["roles"]) or list(value["modules"]) != sorted(value["modules"]) or list(value["drills"]) != sorted(value["drills"]): raise ValueError("operator qualification registry set invalid")
    if len(value["drills"])!=7 or value["fakeAdapters"] != ["fake_clock","fake_inbox","fake_provider","fake_signer","fake_venue"] or value["limits"] != {"attemptMinutes":90,"calibrationDays":30,"calibrationCases":20,"grantDays":30,"kappaDenominator":10,"kappaNumerator":7,"passScore":8000,"scoreMax":10000}: raise ValueError("operator qualification inventory drift")
    for drill in value["drills"].values():
        if set(drill)!={"version","required","forbidden","deadline","hard"} or not isinstance(drill["deadline"],int) or not set(drill["hard"]).issubset(drill["required"]): raise ValueError("drill policy invalid")
    body={k:v for k,v in value.items() if k!="selfHash"}
    if value["selfHash"] != digest(body): raise ValueError("operator qualification registry hash invalid")
    return value
def registry_hash() -> str: return raw()["selfHash"]
