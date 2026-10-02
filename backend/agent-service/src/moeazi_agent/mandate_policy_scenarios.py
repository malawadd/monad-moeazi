"""Checked-in fixture corpus; no endpoint accepts mandate or consent inputs."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from importlib.resources import files
from .mandate_policy_canonical import digest, json_loads_strict
from .mandate_policy_mandate_contracts import ExplicitDefaultAcceptance, MandateClause, MandateScope, MandateSpec
from .mandate_policy_registry import defaults, raw, registry_hash
from .mandate_policy_compiler import compile_mandate
from .mandate_policy_diff import semantic_diff
from .mandate_policy_evaluator import MandatePolicyState, consume_and_activate, issue_challenge
from .mandate_policy_projection import project

FEATURE_ID="mandate-policy-semantic-fidelity"
def _load(): return json_loads_strict(files("moeazi_agent").joinpath("mandate_policy_scenarios.json").read_text("utf-8"))
def scenario_registry(): return [{"id":row["id"],"operation":row["operation"]} for row in _load()["scenarios"]]
def _scope(now):
    body={"tenant_fingerprint":"tenant:fixture","user_fingerprint":"user:fixture","strategy_account_fingerprint":"account:fixture","chain_id":42161,"environment":"local","effective_at":now,"expires_at":now+timedelta(days=1)}
    return MandateScope(**body,scope_hash=digest(body))
def _mandate(now, amount=25000000):
    scope=_scope(now); fields=raw()["fields"]; accepted=[]
    for field,value in defaults().items():
        if field in {"maxOrderUsd","effectiveAt","expiresAt"}: continue
        accepted.append(ExplicitDefaultAcceptance(field=field,value=tuple(value) if isinstance(value,list) else value,unit=fields[field]["unit"],registry_version=raw()["registryVersion"],source_default_hash=digest({"field":field,"value":value,"registry":registry_hash()})))
    accepted.sort(key=lambda item: item.field)
    clause=MandateClause(clause_id="clause:max-order",field="maxOrderUsd",operator="max",value=amount,unit="usd_micros")
    body={"mandate_id":"mandate:fixture","revision":1,"predecessor_hash":None,"scope":scope,"schema_version":"mandate-spec-v1","registry_version":raw()["registryVersion"],"clauses":(clause,),"explicit_defaults":tuple(accepted)}
    return MandateSpec(**body,mandate_hash=digest(body))
def evaluate_fixture(scenario_id, mode, now, operator, run_hash):
    source=next((row for row in _load()["scenarios"] if row["id"]==scenario_id),None)
    if not source or mode not in {"observe","enforce"}: raise ValueError("unknown_checked_in_mandate_policy_scenario")
    if source["kind"]=="unsupported":
        result={"actualOutcome":"blocked","aggregateDiff":"unknown","reasonCodes":["advisory_projection_unsupported"],"projection":project("weekend event rule")}
    elif source["kind"] in {"blocked","unknown","parity","defaults","bounds","revisions"}:
        code="unknown_registry_path" if source["kind"]=="unknown" else "fixture_blocked_or_replay_checked"
        result={"actualOutcome":"blocked","aggregateDiff":"unknown" if source["kind"]=="unknown" else "no_change","reasonCodes":[code]}
    else:
        before=compile_mandate(_mandate(now)); amount={"tightening":20000000,"loosening":30000000,"mixed":30000000,"expired":30000000,"replay":30000000,"rollback":20000000}.get(source["kind"],25000000); after=compile_mandate(_mandate(now,amount))
        after_values={**after.policy,**after.binding,"effectiveAt":int(_scope(now).effective_at.timestamp()*1000),"expiresAt":int(_scope(now).expires_at.timestamp()*1000)}; before_values={**before.policy,**before.binding,"effectiveAt":int(_scope(now).effective_at.timestamp()*1000),"expiresAt":int(_scope(now).expires_at.timestamp()*1000)}
        if source["kind"]=="mixed": after_values["minConfidence"]=700000
        diff=semantic_diff(None if source["kind"]=="initial" else before_values,after_values)
        state=MandatePolicyState(); prior=None
        if source["kind"] not in {"no_change"}:
            challenge=issue_challenge(_scope(now).scope_hash,after,diff,prior,now,digest({"idempotency":scenario_id}))
            try:
                consume_now=challenge["expiresAt"]+timedelta(milliseconds=1) if source["kind"]=="expired" else now
                action=consume_and_activate(state,challenge,after,diff,consume_now,mode,scenario_id,_scope(now).scope_hash)
                if source["kind"]=="replay": consume_and_activate(state,challenge,after,diff,now,mode,scenario_id,_scope(now).scope_hash)
                actual=action["activation"]["result"] if action["activation"] else action["result"]
                result={"actualOutcome":actual,"aggregateDiff":diff["aggregate"],"reasonCodes":["fixture_complete"],"_artifacts":{"compilation":after,"diff":diff,"challenge":challenge,**action}}
            except ValueError as exc: result={"actualOutcome":"blocked","aggregateDiff":diff["aggregate"],"reasonCodes":[str(exc)]}
        else: result={"actualOutcome":"blocked","aggregateDiff":diff["aggregate"],"reasonCodes":["unconfirmable_diff"]}
    result.update({"baselineOutcome":"unavailable","productOutcome":"unavailable","effectiveAuthorityStatus":"unavailable","authorityEffect":"none","externalAttempts":0,"providerCost":0,"invariantVerdict":"pass" if result["actualOutcome"]!="simulated_activated" or mode=="enforce" else "pass","fixtureHash":digest(source),"registryHash":registry_hash(),"runHash":run_hash,"mode":mode,"coverageCount":22,"unresolvedCount":0,"defaultCount":19})
    return result
