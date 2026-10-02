"""Map checked-in observation states to strict inventory items."""
from __future__ import annotations
from .strategy_termination_canonical import digest
from .strategy_termination_inventory_contracts import OwnerObservation, TerminationInventoryItem

def classify(observation: OwnerObservation) -> TerminationInventoryItem:
    state = {"terminal":"terminal_verified", "pending":"pending_safe_step", "residual":"residual_known", "owner_checkpoint":"owner_checkpoint", "unknown":"unknown"}[observation.native_state]
    body = {"observation_hash":observation.observation_hash,"owner":observation.owner,"category":observation.category,"subject_hash":observation.subject_hash,
        "state":state,"disposition":"none_verified" if state == "terminal_verified" else None,
        "reason_code":None if state == "terminal_verified" else f"{observation.category}_{observation.native_state}",
        "next_step_kind":None if state in {"terminal_verified", "residual_known", "unknown"} else "verify_fixture"}
    return TerminationInventoryItem(**body, item_hash=digest(body))
