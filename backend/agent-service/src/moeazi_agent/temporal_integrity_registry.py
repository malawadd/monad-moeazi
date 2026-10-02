"""Checked-in temporal domain registry; no time source is contacted."""
from __future__ import annotations
import json
from importlib.resources import files
from .temporal_integrity_contracts import ClockDomainSpec, digest

def raw() -> dict: return json.loads(files("moeazi_agent").joinpath("temporal_integrity_registry.json").read_text())
def registry_hash() -> str: return digest(raw())

def specs() -> dict[str, ClockDomainSpec]:
    result = {}
    for item in raw()["domains"]:
        body = {"schema_version": 1, "domain_id": item["domainId"], "domain_type": item["domainType"], "owner": item["owner"], "epoch": item["epoch"], "allowed_operations": item["allowedOperations"], "max_uncertainty_us": item["maxUncertaintyUs"], "max_age_us": item["maxAgeUs"], "decision_ttl_us": item["decisionTtlUs"]}
        result[body["domain_id"]] = ClockDomainSpec(**body, spec_hash=digest(body))
    return result

def operation_spec(operation: str) -> ClockDomainSpec:
    key = raw()["operations"].get(operation)
    if not key: raise ValueError("unregistered temporal operation")
    return specs()[key]

def verify_registry() -> None:
    values = specs(); operations = raw()["operations"]
    if raw().get("registryVersion") != "2026-08-11.local-v1" or not values: raise ValueError("invalid temporal registry")
    if any(domain not in values for domain in operations.values()): raise ValueError("operation references missing domain")
    for operation, domain_id in operations.items():
        if operation not in values[domain_id].allowed_operations:
            raise ValueError("operation is not admitted by its temporal domain")
