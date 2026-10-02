import json
from pathlib import Path

import moeazi_agent.test_center as test_center
import moeazi_agent.test_center_api as test_center_api
import moeazi_agent.test_center_fixtures as fixtures
from moeazi_agent.test_center_public import public_run_response

ROOT = Path(__file__).resolve().parents[2]
FORBIDDEN = ("findingCounts", "auditTraceId", "auditPackageHash")
SAFE_SNAPSHOT_KEYS = {"audit", "remediation", "implementationVerification", "productAvailability", "testCenter"}


def contains_forbidden(value):
    if isinstance(value, dict):
        return any(key in FORBIDDEN or contains_forbidden(item) for key, item in value.items())
    if isinstance(value, list):
        return any(contains_forbidden(item) for item in value)
    return False


def test_tracked_registries_have_no_private_audit_keys_and_keep_queue_order():
    paths = (ROOT / "agent-service/src/moeazi_agent/feature_registry.json", ROOT / "docs/agentic-system-research/FEATURE-REGISTRY.json")
    for path in paths:
        registry = json.loads(path.read_text(encoding="utf-8"))
        assert not contains_forbidden(registry)
        assert len(registry["features"]) == 38
        assert [feature["order"] for feature in registry["features"]] == list(range(1, 39))


def test_public_registry_and_snapshot_drop_injected_nested_values(monkeypatch):
    original = fixtures.load_json
    sentinel = "PRIVATE_AUDIT_SENTINEL"

    def injected(name):
        value = original(name)
        if name != "feature_registry.json":
            return value
        feature = dict(value["features"][4])
        feature.update({key: {"nested": sentinel} for key in FORBIDDEN})
        feature["layers"] = {**feature["layers"], "private": sentinel}
        feature["effects"] = {**feature["effects"], "private": True}
        return {**value, "features": [feature, *value["features"][1:]]}

    monkeypatch.setattr(fixtures, "load_json", injected)
    response = fixtures.registry_response()
    first = response["features"][0]
    assert set(first["layers"]) == {"capture", "evaluate", "project", "enforce"}
    assert set(first["effects"]) == {"authority", "cost", "persistence", "sideEffects"}
    assert sentinel not in json.dumps(response, sort_keys=True)
    assert not contains_forbidden(response)

    feature = {**first, **{key: {"nested": sentinel} for key in FORBIDDEN}}
    monkeypatch.setattr(test_center, "feature_entry", lambda _feature_id: feature)
    snapshot = test_center.audit_snapshot("execution-artifact-certification")
    assert set(snapshot) == SAFE_SNAPSHOT_KEYS
    assert sentinel not in json.dumps(snapshot, sort_keys=True)
    assert test_center.canonical_hash(snapshot) == test_center.canonical_hash(dict(reversed(snapshot.items())))


async def test_stored_run_projection_rehashes_and_blocks_hostile_nested_values(monkeypatch):
    sentinel = "PRIVATE_AUDIT_SENTINEL"
    payload = {"runId": "run-a", "result": {"fixtureHash": "safe", "auditPackageHash": sentinel},
        "unknown": sentinel, "auditTraceId": sentinel,
        "auditSnapshot": {"audit": "Reviewed — archived privately", "remediation": "Deferred privately", "implementationVerification": "PASS", "productAvailability": "unavailable", "testCenter": "Isolated enforce", **{key: sentinel for key in FORBIDDEN}}, "auditSnapshotHash": "stale"}
    projected = public_run_response(payload)
    assert set(projected["auditSnapshot"]) == SAFE_SNAPSHOT_KEYS
    assert sentinel not in json.dumps(projected, sort_keys=True)
    assert "unknown" not in projected
    assert not contains_forbidden(projected)
    assert projected["auditSnapshotHash"] == test_center.canonical_hash(projected["auditSnapshot"])

    class Repository:
        async def get_run(self, _run_id, _operator):
            return payload

    monkeypatch.setattr(test_center_api, "authorize", lambda *_args: "operator")
    monkeypatch.setattr(test_center_api, "repository", lambda _request: Repository())
    response = await test_center_api.get_run("run-a", object(), "ignored", "ignored", "a" * 64)
    assert sentinel not in json.dumps(response, sort_keys=True)
    assert "unknown" not in response
    assert not contains_forbidden(response)


def test_features_05_to_08_remain_testable_and_product_unavailable():
    for feature in test_center.registry_response()["features"][4:8]:
        assert test_center.feature_is_testable(feature)
        assert feature["productAvailability"] == "unavailable"
