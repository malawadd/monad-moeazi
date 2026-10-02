"""Pure transition folding; invalid lifecycle history never gains local authority."""
from __future__ import annotations

from .capability_delegation_contracts import GrantLifecycleTransition

REDUCING = {"pending_revocation", "revocation_unknown", "verified_revoked", "expired", "unknown", "disputed"}
VALID = {
    "requested": {"awaiting_user", "submission_unknown"},
    "awaiting_user": {"submitted", "submission_unknown"},
    "submitted": {"active_verified", "submission_unknown"},
    "submission_unknown": {"pending_revocation", "revocation_unknown"},
    "active_verified": {"expiring", "pending_revocation"},
    "expiring": {"pending_revocation", "verified_revoked"},
    "pending_revocation": {"revocation_unknown", "verified_revoked"},
    "revocation_unknown": {"verified_revoked"},
    "verified_revoked": set(),
}


def fold(transitions: list[GrantLifecycleTransition], grant_hash: str) -> tuple[str, str | None, list[str]]:
    rows = [item for item in transitions if item.grant_hash == grant_hash]
    if not rows: return "active_verified", None, []
    rows.sort(key=lambda item: item.sequence)
    previous = None; state = "requested"; reasons: list[str] = []
    for expected, row in enumerate(rows, 1):
        if row.sequence != expected or row.predecessor_hash != previous:
            reasons.append("lifecycle_ambiguous"); break
        if row.from_state != state or row.to_state not in VALID.get(state, set()):
            reasons.append("lifecycle_ambiguous"); break
        state = row.to_state; previous = row.transition_hash
    return state, previous, sorted(set(reasons))
