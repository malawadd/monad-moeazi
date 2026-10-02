"""Synthetic observations only; no native/provider read is available in Feature 08."""
from __future__ import annotations

from datetime import datetime, timedelta

from .capability_delegation_canonical import digest
from .capability_delegation_contracts import CapabilityObservation, GrantSpec


def fixture_observation(grant: GrantSpec, now: datetime, state: str = "active",
                        remaining_native: int | None = None, nonce: int = 1) -> CapabilityObservation:
    body = {"grant_hash": grant.grant_hash, "scope": grant.scope, "native_revision": "fixture:block-1",
        "target_fingerprint": grant.target_fingerprint, "code_hash": grant.certified_code_hash,
        "permitted_actions": grant.actions, "remaining_native": grant.cumulative_native if remaining_native is None else remaining_native,
        "nonce": nonce, "observed_at": now, "expires_at": now + timedelta(minutes=1), "state": state,
        "source_evidence_hash": digest({"fixture": grant.grant_hash, "state": state})}
    return CapabilityObservation(**body, observation_hash=digest(body))
