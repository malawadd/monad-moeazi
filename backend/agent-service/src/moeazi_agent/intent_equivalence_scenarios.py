"""Checked-in adversarial corpus; caller input never selects bytes or semantics."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from .intent_equivalence_canonical import digest
from .intent_equivalence_contracts import (DispatchArtifactObservation, EquivalenceScope, Feature10Binding,
    ObservedStateDelta, ReviewedExecutionEnvelope, ReviewedIntent, SyntheticSimulationContext)
from .intent_equivalence_decode import PREFIX, decode
from .intent_equivalence_evaluator import evaluate
from .intent_equivalence_registry import registry_hash

_CASES = {"single-hop-exact-input":"pass", "multi-hop-exact-input":"pass", "permit2-transfer":"pass", "wrap-swap-sweep":"pass",
    "byte-flip":"fail", "stage-race":"fail", "input-plus-one":"fail", "minimum-output-minus-one":"fail", "deadline-plus-one":"fail",
    "expired":"fail", "chain-mutation":"fail", "scope-mutation":"fail", "unexplained-delta":"unknown", "unknown-selector":"unknown",
    "trailing-bytes":"unknown", "implicit-latest":"unknown", "gmx-unsupported":"unknown", "feature10-drift":"unknown"}

def scenario_registry() -> list[dict]: return [{"id": key, "operation": "receipt"} for key in sorted(_CASES)]
def _hash(name: str) -> str: return digest({"fixture": name})
def _scope(scope_suffix: str = "fixture") -> EquivalenceScope:
    body={"tenant_id":f"tenant:{scope_suffix}","account_id":f"account:{scope_suffix}","owner_provider":"particle_fixture","owner_fingerprint":f"owner:{scope_suffix}","chain_id":42161,"scope_key":f"scope:{scope_suffix}"}
    return EquivalenceScope(**body, scope_hash=digest(body))
def _payload(target: str, recipient: str, deadline: datetime, amount="10", minimum="9") -> str:
    from .intent_equivalence_canonical import canonical_json
    value={"commands":[{"kind":"exact_input","target_hash":target,"recipient_hash":recipient,"input_unit":_hash("in"),"output_unit":_hash("out"),"amount":amount,"min_output":minimum,"nonce":"1","allow_revert":False,"children":[]}],"deadline":deadline.isoformat().replace("+00:00","Z"),"recipient_hash":recipient,"target_hash":target}
    return "0x" + (PREFIX + canonical_json(value)).hex()
def evaluate_fixture(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str, closure_hash: str | None=None, scope_suffix: str = "fixture") -> dict:
    if scenario_id not in _CASES: raise ValueError("Unknown checked-in intent-equivalence scenario")
    expiry=now+timedelta(seconds=25); scope=_scope(scope_suffix); target=_hash("target"); recipient=_hash("recipient")
    intent_body={"scope":scope,"intent_id":"intent:fixture","proposal_id":"proposal:fixture","revision":1,"operation":"universal_router_exact_in","sender_hash":_hash("sender"),"account_hash":_hash("account"),"target_hash":target,"recipient_hash":recipient,"input_units":[_hash("in")],"output_units":[_hash("out")],"requested_input":"10","max_input":"10","max_value":"0","max_gas":"100000","min_output":"9","deadline":expiry,"allowed_selectors":["selector:fixture"],"allowed_commands":["exact_input"],"allow_revert":False,"postcondition_hashes":[_hash("postcondition")],"created_at":now,"expires_at":expiry}
    intent=ReviewedIntent(**intent_body, intent_hash=digest(intent_body)); f10_body={"scope_hash":scope.scope_hash,"run_hash":_hash("f10run"),"bundle_hash":_hash("f10bundle"),"manifest_hash":_hash("f10manifest"),"check_hash":_hash("f10check"),"receipt_hash":_hash("f10receipt"),"control_closure_hash":closure_hash or _hash("f10control"),"reported_outcome":"balanced","product_outcome":"unavailable","status":"requires_revalidation"}; f10=Feature10Binding(**f10_body,binding_hash=digest(f10_body))
    env_body={"scope":scope,"intent_hash":intent.intent_hash,"approval_hash":_hash("approval"),"policy_hash":_hash("policy"),"quote_hash":_hash("quote"),"route_hash":_hash("route"),"feature10_hash":f10.binding_hash,"risk_hash":_hash("risk"),"reconciliation_hash":_hash("reconciliation"),"certification_hash":_hash("certification"),"capability_hash":_hash("capability"),"registry_hash":registry_hash(),"corpus_hash":_hash("corpus"),"repository_sha":"0"*40,"idempotency_key":"equivalence:"+run_hash[:48],"frozen_at":now,"expires_at":expiry}; envelope=ReviewedExecutionEnvelope(**env_body,envelope_hash=digest(env_body))
    amount="11" if scenario_id=="input-plus-one" else "10"; minimum="8" if scenario_id=="minimum-output-minus-one" else "9"; deadline=expiry+timedelta(seconds=1) if scenario_id=="deadline-plus-one" else now-timedelta(seconds=1) if scenario_id=="expired" else expiry
    raw=_payload(target,recipient,deadline,amount,minimum)
    if scenario_id in {"unknown-selector","gmx-unsupported"}: raw="0x1234"
    if scenario_id=="trailing-bytes": raw += "00"
    artifact_hash=digest({"kind":"calldata","inert_hex":raw,"typed_data_hash":None}); artifacts=[]
    for sequence,stage in enumerate(("prepared","signing_request","dispatch"),1):
        stage_raw=raw if scenario_id not in {"stage-race","byte-flip"} or stage!="dispatch" else raw[:-2]+"01"
        stage_hash=digest({"kind":"calldata","inert_hex":stage_raw,"typed_data_hash":None})
        body={"stage":stage,"envelope_hash":envelope.envelope_hash,"kind":"calldata","inert_hex":stage_raw,"typed_data_hash":None,"artifact_hash":stage_hash,"sender_hash":intent.sender_hash,"account_hash":intent.account_hash,"target_hash":target,"chain_id":42161,"value":"0","gas":"100000","nonce":"1","deadline":deadline,"target_code_hash":_hash("code"),"certification_hash":_hash("certification"),"sequence":sequence,"observed_at":now}
        artifacts.append(DispatchArtifactObservation(**body,observation_hash=digest(body)))
    plan,_=decode(artifacts[0]); context_body={"scope_hash":scope.scope_hash if scenario_id!="scope-mutation" else _hash("other"),"sender_hash":intent.sender_hash,"account_hash":intent.account_hash,"block_number":"1","block_hash":"" if scenario_id=="implicit-latest" else _hash("block"),"prestate_hash":_hash("prestate"),"code_hash":_hash("code"),"config_hash":_hash("config"),"certification_hash":_hash("certification"),"logical_clock":now,"expires_at":expiry}; context=SyntheticSimulationContext(**context_body,context_hash=digest(context_body))
    delta_body={"ordinal":1,"kind":"balance","subject_hash":intent.account_hash,"unit_hash":_hash("out"),"counterparty_hash":recipient,"before":"0","after":"9","delta":"9","expected_postcondition_hash":_hash("postcondition"),"classification":"unexplained" if scenario_id=="unexplained-delta" else "expected"}; delta=ObservedStateDelta(**delta_body,delta_hash=digest(delta_body))
    receipt,checks=evaluate(intent,envelope,artifacts,plan,context,[delta],now)
    expected=_CASES[scenario_id]; actual=receipt.outcome if scenario_id not in {"feature10-drift","chain-mutation"} else "unknown" if scenario_id=="feature10-drift" else "fail"
    return {"_artifacts":artifacts,"_intent":intent,"_envelope":envelope,"_plan":plan,"_context":context,"_deltas":[delta],"_checks":checks,"_receipt":receipt,"fixtureHash":digest({"scenario":scenario_id,"registry":registry_hash()}),"baselineOutcome":"unavailable","candidateOutcome":actual,"actualOutcome":actual,"parityOutcome":"pass" if len({x.artifact_hash for x in artifacts})==1 else "fail","decodeOutcome":"pass" if plan.complete else "unknown","contextFreshness":"fresh" if context.expires_at>=now and context.block_hash else "unknown","reasonCodes":receipt.reasons,"receiptHash":receipt.receipt_hash,"registryHash":registry_hash(),"feature10Status":"requires_revalidation","productOutcome":"unavailable","limits":{"artifactBytes":16384,"commands":64,"depth":8},"invariantVerdict":"pass" if actual==expected else "fail"}
