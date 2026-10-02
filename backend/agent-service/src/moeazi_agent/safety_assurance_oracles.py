"""Closed deterministic fixture oracles; no dynamic imports or outside calls."""
from __future__ import annotations
from .safety_assurance_canonical import digest
def canonical_identity(case): return bool(case.get("fixture",{}).get("canonical",True))
def scope_isolated(case): return case.get("fixture",{}).get("scope","valid")=="valid"
def artifact_safe(case): return "secret" not in case.get("fixture",{})
def monotonic(case): return case.get("fixture",{}).get("worsened",False) is False
def reconciliation_hold(case): return case.get("fixture",{}).get("submission","held")!="submitted"
def local_ceiling(case): return case.get("fixture",{}).get("external",False) is False
def source_current(case): return case.get("fixture",{}).get("source","current")=="current"
def retry_singleton(case): return case.get("fixture",{}).get("retries",1)==1
ORACLES={"canonical_identity":canonical_identity,"scope_isolated":scope_isolated,"artifact_safe":artifact_safe,"monotonic":monotonic,"reconciliation_hold":reconciliation_hold,"local_ceiling":local_ceiling,"source_current":source_current,"retry_singleton":retry_singleton}
def run(oracle_id,case):
 if oracle_id not in ORACLES: raise ValueError("assurance_oracle_unregistered")
 return bool(ORACLES[oracle_id](case)),digest({"oracle":oracle_id,"case":case["id"]})
