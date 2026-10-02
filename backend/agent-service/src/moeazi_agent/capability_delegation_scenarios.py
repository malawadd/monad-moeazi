"""Independent checked-in adversarial corpus for local capability evaluation."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from importlib.resources import files

from .capability_delegation_canonical import digest
from .capability_delegation_contracts import CapabilityAction, GrantLifecycleTransition
from .capability_delegation_evaluator import evaluate, frozen_manifest
from .capability_delegation_observations import fixture_observation
from .capability_delegation_registry import fixture_grants, registry_hash, scope

_CASES = {
    "valid-chain-allow": ("use", "normal"), "chain-zero-contract-block": ("use", "wrong_scope"),
    "missing-parent-block": ("use", "missing_parent"), "expired-observation-block": ("use", "expired"),
    "over-limit-block": ("use", "over_limit"), "replayed-nonce-block": ("use", "nonce"),
    "pending-revocation-block": ("use", "pending"), "reconcile-safe-lane": ("reconcile", "expired"),
    "wrong-tenant-block": ("use", "wrong_scope"), "duplicate-transition-block": ("use", "duplicate_transition"),
}


def _expectations() -> dict[str, str]:
    value = json.loads(files("moeazi_agent").joinpath("capability_delegation_expectations.json").read_text("utf-8"))
    if set(value) != {"schemaVersion", "expectations"} or value["schemaVersion"] != 1 or set(value["expectations"]) != set(_CASES):
        raise ValueError("capability scenario expectations are not closed")
    return value["expectations"]


def scenario_registry() -> list[dict]: return [{"id": key, "operation": value[0]} for key, value in sorted(_CASES.items())]


def _action(operation: str, now: datetime, value: int = 10, nonce: int = 1) -> CapabilityAction:
    return CapabilityAction(operation=operation, target_fingerprint="target:fixture", selector="selector:trade",
        action="action:use", token="token:usdc", instrument="instrument:eth", market="market:eth-usdc",
        recipient="recipient:venue", native_value=value, gas_native=1, valid_from=now - timedelta(seconds=1),
        valid_until=now + timedelta(minutes=1), nonce=nonce, replay_domain="nonce:fixture")


def _transition(grant_hash: str, now: datetime, seq: int, predecessor: str | None = None) -> GrantLifecycleTransition:
    body = {"grant_hash": grant_hash, "predecessor_hash": predecessor, "from_state": "active_verified",
        "to_state": "pending_revocation", "sequence": seq, "transitioned_at": now,
        "trigger_hash": digest({"fixture": grant_hash, "sequence": seq})}
    return GrantLifecycleTransition(**body, transition_hash=digest(body))


def evaluate_fixture(scenario_id: str, mode: str, now: datetime, operator: str, run_hash: str) -> dict:
    if scenario_id not in _CASES: raise ValueError("Unknown checked-in capability scenario")
    operation, fault = _CASES[scenario_id]; expected = _expectations()[scenario_id]
    grants = fixture_grants(now); action = _action(operation, now, 60 if fault == "over_limit" else 10, 2 if fault == "nonce" else 1)
    observations = [fixture_observation(item, now, "expired" if fault == "expired" else "active", nonce=1) for item in grants]
    transitions: list[GrantLifecycleTransition] = []
    if fault == "missing_parent": grants = [item for item in grants if item.grant_type != "eip7702_root"]
    if fault == "wrong_scope":
        grant = grants[-1]; body = grant.model_dump(exclude={"grant_hash"}); body["scope"] = scope().model_copy(update={"tenant_id": "tenant:other"})
        from .capability_delegation_contracts import GrantSpec
        grants[-1] = GrantSpec(**body, grant_hash=digest(body))
    if fault in {"pending", "duplicate_transition"}:
        first = _transition(grants[0].grant_hash, now, 1)
        transitions = [first]
        if fault == "duplicate_transition": transitions.append(_transition(grants[0].grant_hash, now, 1))
    corpus_hash = digest({"scenario": scenario_id, "registry": registry_hash()})
    manifest = frozen_manifest(scope(), action, grants, observations, transitions, now,
        f"capability:{run_hash[:48]}", corpus_hash)
    decision = evaluate(scope(), action, grants, observations, transitions, manifest, now)
    return {"_decision": decision, "_inputManifest": manifest, "_grants": grants,
        "_observations": observations, "_transitions": transitions, "fixtureHash": corpus_hash,
        "baselineOutcome": "unavailable", "candidateOutcome": decision.outcome, "actualOutcome": decision.outcome,
        "grantClass": "synthetic_chain", "lifecycleState": "pending_revocation" if transitions else "active_verified",
        "observationFreshness": "stale" if fault == "expired" else "fresh", "effectiveNative": decision.exposure_before_native,
        "residualNative": decision.exposure_after_native, "revocationStatus": "pending" if transitions else "not_requested",
        "permittedLanes": decision.permitted_safe_lanes, "decisionHash": decision.decision_hash,
        "registryHash": registry_hash(), "productOutcome": "unavailable", "reasons": decision.reasons,
        "invariantVerdict": "pass" if decision.outcome == expected else "fail"}
