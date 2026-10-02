"""Independent checked-in termination corpus. Inputs do not declare outcomes."""
from __future__ import annotations
from datetime import datetime, timedelta
from importlib.resources import files
from .strategy_termination_canonical import digest, json_loads_strict
from .strategy_termination_decision_contracts import OwnerCheckpoint, ResidualObligation
from .strategy_termination_evaluator import evaluate
from .strategy_termination_inventory import classify
from .strategy_termination_inventory_contracts import OwnerManifest, OwnerObservation, TerminationInventorySnapshot
from .strategy_termination_planner import build
from .strategy_termination_registry import registry_hash
from .strategy_termination_scope_contracts import ContextReleaseBinding, DirectDependencyBinding, StrategyTerminationRequest, TerminationLatch, TerminationScope
from .strategy_termination_workflow_contracts import TerminationAttemptTransition, TerminationStepAttempt, TerminationStepReceipt

def _load(name: str): return json_loads_strict(files("moeazi_agent").joinpath(name).read_text("utf-8"))
def scenario_registry() -> list[dict]: return [{"id":x["id"], "operation":"replay"} for x in _load("strategy_termination_scenarios.json")["scenarios"]]
def _h(name: str) -> str: return digest({"fixture":name})

def evaluate_fixture(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str,
                     closure_hash: str | None = None, prerequisites: dict | None = None) -> dict:
    source = next((x for x in _load("strategy_termination_scenarios.json")["scenarios"] if x["id"] == scenario_id), None)
    if not source or mode not in {"observe", "enforce"}: raise ValueError("Unknown checked-in termination scenario")
    scope_body = {"operator_test_id": operator, "tenant_fingerprint":"tenant:fixture", "account_fingerprint":"account:fixture","strategy_fingerprint":"strategy:fixture","owner_fixture":"particle_fixture","chain_id":42161,"termination_revision":1}
    scope = TerminationScope(**scope_body, scope_hash=digest(scope_body)); expiry = now + timedelta(seconds=30)
    request_body = {"scope_hash":scope.scope_hash,"termination_revision":1,"reason":"fixture_replay","requested_outcome":"full_termination","idempotency_key":f"termination:{run_hash[:48]}","requested_at":now}
    request = StrategyTerminationRequest(**request_body, request_hash=digest(request_body))
    latch_body = {"scope_hash":scope.scope_hash,"request_hash":request.request_hash,"termination_revision":1,"predecessor_latch_hash":None,"epoch":1,"committed_at":now,"denied_operations":sorted(["analysis_dispatch","approval_create","authority_expand","open","prepare","proposal_create","reservation_increase","sign","submit"]),"recovery_safe_operations":["inspect","read_only_reconcile"]}
    latch = TerminationLatch(**latch_body, latch_hash=digest(latch_body))
    if not prerequisites or set(prerequisites) != {"cross-state-recovery-continuity", "intent-execution-equivalence"}:
        raise ValueError("exact persisted Feature 02 and Feature 11 prerequisite runs are required")
    dependencies=[]
    for feature, release in (("cross-state-recovery-continuity","0b6a22090be3ed8f2897606a15dd2db6abca504e"),("intent-execution-equivalence","3b5c38bb150b360b5ed778651a0a0c0150817144")):
        selected=prerequisites[feature]
        body={"feature_id":feature,"operator_test_id":operator,"scope_relation":"same_operator_fixture","run_id":selected["runId"],"run_hash":selected["runHash"],"bundle_hash":selected["bundleHash"],"control_hash":selected["controlHash"],"registry_hash":selected["registryHash"],"release_hash":release,"expires_at":expiry,"status":"requires_revalidation"}
        dependencies.append(DirectDependencyBinding(**body,binding_hash=digest(body)))
    context_body={"feature_id":"collateral-resilience-exit-capacity","release_hash":"2f61902de9c378607511a9d4bf31ec0cfb47cb8a","registry_hash":_h("feature13-registry"),"attribution":"untrusted_context_only"}
    context=ContextReleaseBinding(**context_body,binding_hash=digest(context_body))
    manifest_body={"scope_hash":scope.scope_hash,"owners":["owner:automation","owner:execution"],"categories":["jobs","submissions"]}; manifest=OwnerManifest(**manifest_body,manifest_hash=digest(manifest_body))
    observations=[]
    for index, state in enumerate(source["states"]):
        body={"scope_hash":scope.scope_hash,"owner":manifest.owners[index],"category":manifest.categories[index],"subject_hash":_h(f"{scenario_id}:{index}"),"native_state":state,"coordinate_hash":_h(f"coordinate:{scenario_id}:{index}"),"predecessor_hash":None,"evidence_hash":_h(f"evidence:{scenario_id}:{index}"),"source_hash":_h(f"source:{scenario_id}:{index}"),"effective_at":now,"observed_at":now,"expires_at":expiry}
        observations.append(OwnerObservation(**body,observation_hash=digest(body)))
    items=[classify(x) for x in observations]
    snapshot_body={"scope_hash":scope.scope_hash,"latch_hash":latch.latch_hash,"manifest_hash":manifest.manifest_hash,"dependency_hashes":sorted(x.binding_hash for x in dependencies),"item_hashes":sorted(x.item_hash for x in items),"frozen_at":now,"snapshot_revision":1}
    snapshot=TerminationInventorySnapshot(**snapshot_body,snapshot_hash=digest(snapshot_body)); plan,steps=build(scope,latch,snapshot,items)
    attempts=[]; receipts=[]
    for step, item in zip(steps, sorted(items, key=lambda x: (x.category, x.subject_hash))):
        attempt_body={"step_hash":step.step_hash,"attempt":1,"predecessor_receipt_hash":None,"idempotency_key":f"attempt:{step.step_hash[:48]}","input_hash":item.item_hash,"observed_at":now}
        attempt=TerminationStepAttempt(**attempt_body,attempt_hash=digest(attempt_body)); attempts.append(attempt)
        outcome={"terminal_verified":"verified_terminal","pending_safe_step":"pending","residual_known":"residual","owner_checkpoint":"pending","unknown":"unknown"}[item.state]
        receipt_body={"attempt_hash":attempt.attempt_hash,"step_hash":step.step_hash,"pre_state_hash":item.item_hash,"post_state_hash":observations[items.index(item)].observation_hash,"outcome":outcome,"side_effect_count":0,"observed_at":now}
        receipts.append(TerminationStepReceipt(**receipt_body,receipt_hash=digest(receipt_body)))
    decision, completion=evaluate(scope,latch,snapshot,plan,items,receipts,[source["postLatchOperation"]] if source.get("postLatchOperation") else [])
    expected=_load("strategy_termination_expectations.json")[scenario_id]
    residuals=[]; checkpoints=[]
    for item in items:
        if item.state != "terminal_verified":
            body={"item_hash":item.item_hash,"owner":item.owner,"category":item.category,"state":"owner_checkpoint" if item.state=="owner_checkpoint" else "unknown" if item.state=="unknown" else "residual","reason_code":item.reason_code or "pending_safe_work","recovery_instruction":"owner_decision" if item.state=="owner_checkpoint" else "read_only_reconcile","blocks_completion":True}
            residuals.append(ResidualObligation(**body,residual_hash=digest(body)))
        if item.state == "owner_checkpoint":
            checkpoint_body={"scope_hash":scope.scope_hash,"subject_hash":item.subject_hash,"action":"owner_decision","reason_code":item.reason_code or "owner_checkpoint","cost_state":"unknown","decision":"pending","expires_at":expiry}
            checkpoints.append(OwnerCheckpoint(**checkpoint_body,checkpoint_hash=digest(checkpoint_body)))
    first_event={"scope_hash":scope.scope_hash,"predecessor_hash":None,"state":"latched"}; transition=TerminationAttemptTransition(**first_event,event_hash=digest(first_event))
    return {"_scope":scope,"_request":request,"_latch":latch,"_dependencies":dependencies,"_context":context,"_manifest":manifest,"_observations":observations,"_items":items,"_snapshot":snapshot,"_plan":plan,"_steps":steps,"_attempts":attempts,"_receipts":receipts,"_checkpoints":checkpoints,"_transitions":[transition],"_residuals":residuals,"_decision":decision,"_completion":completion,
        "fixtureHash":digest({"scenario":scenario_id,"registry":registry_hash()}),"baselineOutcome":"unavailable","candidateOutcome":decision.state,"actualOutcome":decision.state,"workflowState":decision.state,"latchState":"latched","automationStopVerified":decision.automation_stop_verified,"categoryCounts":{"terminal":decision.terminal_count,"pending":decision.pending_count,"residual":decision.residual_count,"unknown":decision.unknown_count,"ownerCheckpoint":decision.owner_checkpoint_count},"reasonCodes":decision.reason_codes,"costState":"known_fixture_zero","recoveryAccess":"read_only_reconcile","decisionHash":decision.decision_hash,"completionHash":completion.completion_hash if completion else None,"registryHash":registry_hash(),"productOutcome":"unavailable","externalAttempts":0,"invariantVerdict":"pass" if decision.state==expected else "fail"}
