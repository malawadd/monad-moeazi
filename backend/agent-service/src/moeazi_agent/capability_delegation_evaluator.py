"""Deterministic local capability matrix. It has no execution or network import."""
from __future__ import annotations

from datetime import datetime, timedelta

from .capability_delegation_canonical import digest
from .capability_delegation_contracts import (CapabilityAction, CapabilityDecision,
    CapabilityInputManifest, CapabilityObservation, CapabilityScope, GrantLifecycleTransition, GrantSpec)
from .capability_delegation_lifecycle import fold
from .capability_delegation_registry import raw

RISKY = {"prepare", "activate", "use", "replace"}
SAFE = {"cancel", "reduce", "revoke", "reconcile"}


def action_hash(action: CapabilityAction) -> str: return digest(action)


def frozen_manifest(scope: CapabilityScope, action: CapabilityAction, grants: list[GrantSpec],
                    observations: list[CapabilityObservation], transitions: list[GrantLifecycleTransition],
                    now: datetime, key: str, corpus_hash: str) -> CapabilityInputManifest:
    request = digest({"scope": scope, "action": action_hash(action), "key": key,
        "grants": sorted(item.grant_hash for item in grants), "observations": sorted(item.observation_hash for item in observations)})
    head = max((item.transition_hash for item in transitions), default=None)
    body = {"scope": scope, "operation": action.operation, "registry_hash": digest(raw()), "corpus_hash": corpus_hash,
        "grant_hashes": sorted(item.grant_hash for item in grants), "observation_hashes": sorted(item.observation_hash for item in observations),
        "action_hash": action_hash(action), "lifecycle_head_hash": head,
        "feature05_context_hash": digest({"fixture": "feature05-unavailable"}),
        "feature06_context_hash": digest({"fixture": "feature06-unavailable"}), "frozen_at": now,
        "idempotency_key": key, "request_hash": request}
    return CapabilityInputManifest(**body, manifest_hash=digest(body))


def evaluate(scope: CapabilityScope, action: CapabilityAction, grants: list[GrantSpec],
             observations: list[CapabilityObservation], transitions: list[GrantLifecycleTransition],
             manifest: CapabilityInputManifest, now: datetime) -> CapabilityDecision:
    reasons: list[str] = []; required = sorted(item.grant_hash for item in grants); by_hash = {item.grant_hash: item for item in grants}
    obs = {item.grant_hash: item for item in observations}; safe = sorted(set(raw()["safeLanes"]).intersection(SAFE))
    if scope.chain_id != 42161 or any(item.scope != scope for item in grants): reasons.append("chain_or_scope_mismatch")
    if manifest.scope != scope or manifest.action_hash != action_hash(action): reasons.append("replay_mismatch")
    if not grants: reasons.append("ancestor_missing")
    roots = [item for item in grants if item.grant_type == "eip7702_root"]
    if len(roots) != 1: reasons.append("ancestor_missing")
    visited: set[str] = set(); visiting: set[str] = set()
    def visit(grant: GrantSpec):
        if grant.grant_hash in visited: return
        if grant.grant_hash in visiting:
            reasons.append("parent_cycle"); return
        visiting.add(grant.grant_hash)
        visited.add(grant.grant_hash)
        for parent in grant.parent_hashes:
            if parent not in by_hash: reasons.append("ancestor_missing"); continue
            visit(by_hash[parent])
        visiting.remove(grant.grant_hash)
    for grant in grants: visit(grant)
    if len(visited) != len(grants): reasons.append("parent_cycle")
    exposure = 0
    for grant in grants:
        if action.action not in raw()["grantActionMatrix"].get(grant.grant_type, []):
            reasons.append("action_scope_mismatch")
        state, _, lifecycle_reasons = fold(transitions, grant.grant_hash); reasons.extend(lifecycle_reasons)
        observation = obs.get(grant.grant_hash)
        if observation is None: reasons.append("observation_missing"); continue
        if observation.scope != scope or observation.target_fingerprint != grant.target_fingerprint:
            reasons.append("chain_or_scope_mismatch")
        if observation.nonce != action.nonce:
            reasons.append("replay_mismatch")
        if action.replay_domain != grant.nonce_domain:
            reasons.append("replay_mismatch")
        if not (action.valid_from <= now < action.valid_until):
            reasons.append("action_expired")
        if observation.state != "active" or observation.expires_at <= now or grant.effective_until and grant.effective_until <= now:
            reasons.append("observation_stale" if observation.expires_at <= now else "grant_inactive")
        if state != "active_verified": reasons.append("revocation_pending" if state in {"pending_revocation", "revocation_unknown"} else "grant_inactive")
        if action.action not in grant.actions or action.selector not in grant.selectors or action.target_fingerprint != grant.target_fingerprint:
            reasons.append("action_scope_mismatch")
        if action.action not in observation.permitted_actions:
            reasons.append("observation_action_scope_mismatch")
        for field in ("token", "instrument", "market", "recipient"):
            expected, requested = getattr(grant, field), getattr(action, field)
            if expected is not None and requested != expected:
                reasons.append("action_scope_mismatch")
        if action.native_value > min(grant.per_call_native, grant.daily_native, grant.cumulative_native, observation.remaining_native) or action.gas_native > grant.gas_native:
            reasons.append("limit_exceeded")
        exposure = min(grant.cumulative_native, observation.remaining_native) if exposure == 0 else min(exposure, grant.cumulative_native, observation.remaining_native)
    reasons = sorted(set(reasons))
    if action.operation in RISKY:
        outcome = "allow" if not reasons and len(grants) > 1 else "deny"
    elif action.operation in SAFE:
        outcome = "allow" if not reasons else "close_or_reconcile_only"
    else: outcome = "unknown" if reasons else "allow"
    body = {"scope": scope, "action_hash": action_hash(action), "input_manifest_hash": manifest.manifest_hash,
        "required_grant_hashes": required, "required_observation_hashes": sorted(item.observation_hash for item in observations),
        "ancestry_hash": digest(required), "lifecycle_head_hash": manifest.lifecycle_head_hash, "outcome": outcome,
        "reasons": reasons, "permitted_safe_lanes": safe if outcome == "close_or_reconcile_only" else [],
        "exposure_before_native": exposure, "exposure_after_native": 0 if outcome != "allow" else exposure,
        "expires_at": now + timedelta(seconds=raw()["decisionTtlSeconds"]), "idempotency_key": manifest.idempotency_key,
        "request_hash": manifest.request_hash}
    return CapabilityDecision(**body, decision_hash=digest(body))
