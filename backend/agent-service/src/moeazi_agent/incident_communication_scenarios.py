"""Independent checked-in fixture corpus; expected outcomes remain outside inputs."""
from __future__ import annotations
from datetime import datetime
from importlib.resources import files
from .incident_communication_canonical import digest, json_loads_strict
from .incident_communication_contracts import SafetyIncidentRevisionRef
from .incident_communication_evaluator import evaluate
from .incident_communication_registry import registry_hash

def _load(name: str): return json_loads_strict(files("moeazi_agent").joinpath(name).read_text("utf-8"))
def scenario_registry() -> list[dict]: return [{"id":x["id"],"operation":"replay"} for x in _load("incident_communication_scenarios.json")["scenarios"]]

def evaluate_fixture(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str) -> dict:
    source=next((x for x in _load("incident_communication_scenarios.json")["scenarios"] if x["id"]==scenario_id),None)
    if not source or mode not in {"observe","enforce"}: raise ValueError("Unknown checked-in incident communication scenario")
    revision=source.get("revision",1); predecessor=digest({"predecessor":scenario_id}) if source.get("predecessor") else None
    body={"operator_test_id":operator,"tenant_fingerprint":"tenant:fixture","account_fingerprint":"account:fixture","incident_id":"incident:fixture","revision":revision,"predecessor_revision_hash":predecessor,"authoritative_owner":"dependency_safety_fixture","owner_contract_hash":digest({"owner":"fixture"}),"owner_release_hash":"0000000000000000000000000000000000000000","severity":"high","state":source.get("state","open"),"materiality":"material","reason_code":source["reason"],"event_at":now,"source_receipt_hashes":[digest({"receipt":scenario_id})]}
    incident=SafetyIncidentRevisionRef(**body,revision_hash=digest(body))
    result=evaluate(incident,now=now,cross_tenant=source.get("crossTenant",False),failure=source.get("failure"),duplicate=source.get("duplicate",False),stale_ack=source.get("staleAck",False),wrong_recipient=source.get("wrongRecipient",False),superseded=source.get("superseded",False))
    expected=_load("incident_communication_expectations.json")[scenario_id]
    result.update({"fixtureHash":digest({"scenario":scenario_id,"shape":sorted(source),"registry":registry_hash()}),"registryHash":registry_hash(),"semanticShapeHash":digest({"scenario":scenario_id,"shape":source}),"runHash":run_hash,"invariantVerdict":"pass" if result["actualOutcome"]==expected else "fail"})
    return result
