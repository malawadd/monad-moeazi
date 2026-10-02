from datetime import datetime, timezone

import pytest

from moeazi_agent.execution_artifact_contracts import ArtifactScope, canonical_json, digest
from moeazi_agent.execution_artifact_evaluator import evaluate, make_observation
from moeazi_agent.execution_artifact_registry import closure, verify_registry
from moeazi_agent.execution_artifact_scenarios import evaluate_fixture
from moeazi_agent.execution_artifact_scenarios import scenario_registry
from moeazi_agent.execution_artifact_topology import FixtureArtifactReader, resolve_topology


NOW = datetime(2026, 8, 11, tzinfo=timezone.utc)


def test_registry_is_transitive_and_has_separate_safety_roots():
    verify_registry()
    scope = ArtifactScope(kind="account", key="account:fixture")
    prepare = {item.artifact_id for item in closure("uniswap_trading_prepare", scope)}
    assert prepare.isdisjoint({item.artifact_id for item in closure("emergency_close", scope)})
    assert prepare.isdisjoint({item.artifact_id for item in closure("read_only_reconcile", scope)})


def test_fixture_drift_is_close_only_and_reconcile_is_independent():
    drift = evaluate_fixture("artifact-runtime-drift-close-only", "observe", NOW, "operator", "a" * 64)
    reconcile = evaluate_fixture("artifact-reconcile-survives-submit-drift", "observe", NOW, "operator", "b" * 64)
    assert drift["candidateOutcome"] == "close_only"
    assert drift["permittedLanes"] == ["close", "reconcile"]
    assert reconcile["candidateOutcome"] == "pass"


def test_canonical_contract_rejects_floats():
    with pytest.raises(ValueError, match="floating"):
        canonical_json({"notAllowed": 0.1})


def test_every_checked_in_scenario_executes_its_real_evaluator():
    for index, scenario in enumerate(scenario_registry()):
        result = evaluate_fixture(scenario["id"], "observe", NOW, "operator", f"{index:064x}")
        assert result["invariantVerdict"] == "pass"


def test_fixture_topologies_fail_closed_when_ambiguous():
    for topology in ("direct", "transparent", "uups", "beacon"):
        fixture = {"topology": topology, "runtimeHash": "fixture", "slots": {"implementation": "impl", "admin": "admin"}, "proxiableEvidence": True, "beaconImplementation": "impl"}
        if topology == "direct": fixture["slots"] = {}
        if topology == "uups": fixture["slots"].pop("admin")
        if topology == "beacon": fixture["slots"] = {"beacon": "beacon"}
        assert resolve_topology(FixtureArtifactReader({topology: fixture}), topology)[0] == topology
    assert resolve_topology(FixtureArtifactReader({"bad": {"runtimeHash": "fixture", "slots": {"beacon": "x"}}}), "bad")[0] == "unknown"


def test_duplicate_and_overlong_observations_fail_closed():
    scope = ArtifactScope(kind="account", key="account:fixture")
    spec = closure("uniswap_trading_prepare", scope)[0]
    observation = make_observation(spec, "prepare", NOW, digest({"fixture": "duplicate"}))
    duplicate = evaluate("uniswap_trading_prepare", scope, [observation, observation], NOW, "artifact:duplicate")
    assert duplicate.outcome == "block" and "duplicate_observation" in duplicate.reasons
    body = observation.model_dump(exclude={"observation_hash"})
    body["expires_at"] = spec.expires_at
    forged = observation.__class__(**body, observation_hash=digest(body))
    result = evaluate("uniswap_trading_prepare", scope, [forged], NOW, "artifact:expiry")
    assert result.outcome == "block" and "observation_expiry_exceeds_policy" in result.reasons


def test_decision_freezes_request_and_input_manifest_identity():
    scope = ArtifactScope(kind="account", key="account:fixture")
    spec = closure("uniswap_trading_prepare", scope)[0]
    observation = make_observation(spec, "prepare", NOW, digest({"fixture": "manifest"}))
    decision = evaluate("uniswap_trading_prepare", scope, [observation], NOW, "artifact:manifest")
    assert len(decision.input_manifest_hash) == len(decision.request_hash) == 64
    with pytest.raises(ValueError):
        decision.__class__(**decision.model_dump(exclude={"decision_hash"}), decision_hash="0" * 64)
