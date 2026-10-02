from datetime import datetime, timezone

from moeazi_agent.test_center import (
    audit_snapshot, canonical_hash, feature_is_testable, registry_response, run_fixture,
)

NOW = datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc)


def synthetic_feature(**changes):
    value = {
        "availability": "available", "implementation": "Implemented",
        "implementationVerification": "PASS", "testCenter": "Isolated enforce",
        "audit": "Reviewed — findings deferred", "remediation": "Deferred to roadmap audit goal",
        "productAvailability": "unavailable",
    }
    return {**value, **changes}


def test_deferred_audit_state_does_not_gate_verified_isolated_execution():
    assert feature_is_testable(synthetic_feature())
    assert not feature_is_testable(synthetic_feature(implementationVerification="Pending"))
    assert not feature_is_testable(synthetic_feature(implementation="Blocked"))
    assert not feature_is_testable(synthetic_feature(testCenter="Unavailable"))
    assert not feature_is_testable(synthetic_feature(availability="unavailable"))


def test_feature03_separates_product_activation_from_test_center_execution():
    feature = registry_response()["features"][2]
    assert feature["id"] == "evidence-lifecycle-boundary"
    assert feature["productAvailability"] == "unavailable"
    assert feature["testCenter"] == "Isolated enforce"
    assert run_fixture("lifecycle-nested-secret-blocked", "enforce", NOW, feature["id"])["invariantVerdict"] == "pass"


def test_frozen_audit_state_is_deterministic_and_coarse():
    snapshot = audit_snapshot("evidence-lifecycle-boundary")
    assert set(snapshot) == {"audit", "remediation", "implementationVerification", "productAvailability", "testCenter"}
    assert canonical_hash(snapshot) == canonical_hash(dict(reversed(list(snapshot.items()))))


def test_all_features_keep_test_center_and_product_availability_contracts():
    registry = registry_response()
    assert len(registry["features"]) == 38
    assert [item["order"] for item in registry["features"]] == list(range(1, 39))
    assert all(item["testCenter"] == "Isolated enforce" for item in registry["features"])
    assert registry["features"][0]["productAvailability"] == "observe"
    assert all(item["productAvailability"] == "unavailable" for item in registry["features"][1:])
