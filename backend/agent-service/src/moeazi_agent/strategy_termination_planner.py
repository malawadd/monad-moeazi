"""Deterministic, acyclic plan construction; it never invokes an adapter."""
from __future__ import annotations
from .strategy_termination_canonical import digest
from .strategy_termination_inventory_contracts import TerminationInventoryItem, TerminationInventorySnapshot
from .strategy_termination_scope_contracts import TerminationScope, TerminationLatch
from .strategy_termination_workflow_contracts import TerminationPlan, TerminationStep

def build(scope: TerminationScope, latch: TerminationLatch, snapshot: TerminationInventorySnapshot,
          items: list[TerminationInventoryItem]) -> tuple[TerminationPlan, list[TerminationStep]]:
    steps = []
    for item in sorted(items, key=lambda x: (x.category, x.subject_hash)):
        kind = item.next_step_kind or "classify_terminal"
        body = {"scope_hash":scope.scope_hash,"strategy_fingerprint":scope.strategy_fingerprint,"termination_revision":scope.termination_revision,
            "step_kind":kind,"subject_hash":item.subject_hash,"dependencies":[],"action_class":"safe_fixture" if item.state == "pending_safe_step" else "classify"}
        step_id = f"{scope.strategy_fingerprint}:{scope.termination_revision}:{kind}:{item.subject_hash}"
        steps.append(TerminationStep(**body, step_id=step_id, step_hash=digest({**body,"step_id":step_id})))
    plan_body = {"scope_hash":scope.scope_hash,"latch_hash":latch.latch_hash,"snapshot_hash":snapshot.snapshot_hash,"ordered_step_hashes":[x.step_hash for x in steps]}
    return TerminationPlan(**plan_body, plan_hash=digest(plan_body)), steps
