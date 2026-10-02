"""Fail-closed monotonic status evaluator for synthetic termination evidence."""
from __future__ import annotations
from .strategy_termination_canonical import digest
from .strategy_termination_decision_contracts import TerminationStatusDecision, TerminationCompletionReceipt
from .strategy_termination_inventory_contracts import TerminationInventoryItem, TerminationInventorySnapshot
from .strategy_termination_scope_contracts import TerminationLatch, TerminationScope
from .strategy_termination_workflow_contracts import TerminationPlan, TerminationStepReceipt

RISK_INCREASING = {"analysis_dispatch","proposal_create","approval_create","reservation_increase","prepare","sign","submit","open","authority_expand"}

def evaluate(scope: TerminationScope, latch: TerminationLatch, snapshot: TerminationInventorySnapshot, plan: TerminationPlan,
             items: list[TerminationInventoryItem], receipts: list[TerminationStepReceipt], post_latch_operations: list[str] = []) -> tuple[TerminationStatusDecision, TerminationCompletionReceipt | None]:
    terminal = sum(x.state == "terminal_verified" for x in items); pending = sum(x.state == "pending_safe_step" for x in items)
    residual = sum(x.state == "residual_known" for x in items); unknown = sum(x.state == "unknown" for x in items); owner = sum(x.state == "owner_checkpoint" for x in items)
    reasons: list[str] = []; invalid = bool(RISK_INCREASING.intersection(post_latch_operations)) or not items
    if invalid: state, stopped, reasons = "termination_unverified", False, ["post_latch_increase" if post_latch_operations else "inventory_incomplete"]
    elif owner: state, stopped, reasons = "blocked_needs_owner", True, ["owner_checkpoint_required"]
    elif residual or unknown or any(x.outcome in {"residual","unknown","conflict"} for x in receipts): state, stopped, reasons = "stopped_with_residuals", True, ["residual_or_unknown"]
    elif pending: state, stopped, reasons = "automation_stopped_verified", True, ["safe_fixture_work_pending"]
    else: state, stopped = "fully_terminated_verified", True
    body = {"scope_hash":scope.scope_hash,"latch_hash":latch.latch_hash,"snapshot_hash":snapshot.snapshot_hash,"plan_hash":plan.plan_hash,"state":state,
        "automation_stop_verified":stopped,"terminal_count":terminal,"pending_count":pending,"residual_count":residual,"unknown_count":unknown,"owner_checkpoint_count":owner,"reason_codes":reasons}
    decision = TerminationStatusDecision(**body, decision_hash=digest(body)); completion = None
    if state == "fully_terminated_verified":
        complete = {"decision_hash":decision.decision_hash,"latch_hash":latch.latch_hash,"snapshot_hash":snapshot.snapshot_hash,"plan_hash":plan.plan_hash,"receipt_hashes":sorted(x.receipt_hash for x in receipts),"product_availability":"unavailable"}
        completion = TerminationCompletionReceipt(**complete, completion_hash=digest(complete))
    return decision, completion
