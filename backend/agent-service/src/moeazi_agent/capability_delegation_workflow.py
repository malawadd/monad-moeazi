"""Unregistered local command reducer for replay and ordering tests only."""
from __future__ import annotations

from .capability_delegation_contracts import GrantLifecycleTransition
from .capability_delegation_lifecycle import fold


def reduce_transitions(grant_hash: str, transitions: list[GrantLifecycleTransition]) -> dict:
    state, head, reasons = fold(transitions, grant_hash)
    return {"grantHash": grant_hash, "state": state, "head": head, "reasons": reasons,
            "dispatchDisabled": state != "active_verified"}
