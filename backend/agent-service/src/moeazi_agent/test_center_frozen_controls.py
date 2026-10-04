"""Frozen, transitive Test Center control snapshots.

This remains a Redis-read-only helper.  It never broadens the Test Center's
authority; missing or changed prerequisite controls fail closed.
"""
from __future__ import annotations

import json


async def freeze_control_snapshot(redis, operator_id: str, feature_id: str,
                                  expected_hash: str) -> dict:
    # Imported on demand to keep the public Test Center contracts in one module
    # without a module-initialization cycle.
    from .test_center import (canonical_hash, controls_key, feature_ancestry,
        feature_dependencies, feature_testable, prerequisite_ready, valid_controls)

    if not feature_testable(feature_id):
        raise RuntimeError("Test Center feature is unavailable")
    dependencies = feature_ancestry(feature_id)
    keys = [controls_key(operator_id, feature_id)] + [controls_key(operator_id, item)
        for item in dependencies]
    raw = await redis.eval("return redis.call('MGET', unpack(KEYS))", len(keys), *keys)
    values = list(raw or [])
    target = valid_controls(json.loads(values[0]) if values and values[0] else None, feature_id)
    if not target or target["controlHash"] != expected_hash:
        raise RuntimeError("Test Center controls changed or expired; refresh before running")
    controls = {feature_id: target}
    for index, dependency_id in enumerate(dependencies, 1):
        prerequisite = valid_controls(json.loads(values[index]) if len(values) > index
            and values[index] else None, dependency_id)
        if not prerequisite or not prerequisite_ready(prerequisite, target["effectiveMode"]):
            raise RuntimeError("Test Center prerequisite closure changed or expired")
        controls[dependency_id] = prerequisite
    for child_id, child in controls.items():
        for parent_id in feature_dependencies(child_id):
            parent = controls.get(parent_id)
            binding = next((item for item in child["prerequisiteBindings"]
                if item["featureId"] == parent_id), None)
            if not parent or not binding or any(binding[key] != parent[key] for key in
                    ("featureId", "revision", "registryHash", "controlHash")):
                raise RuntimeError("Test Center prerequisite binding changed or expired")
    frozen = [{"featureId": item["featureId"], "revision": item["revision"],
        "registryHash": item["registryHash"], "controlHash": item["controlHash"]}
        for _, item in sorted(controls.items())]
    return {**target, "frozenPrerequisiteBindings": frozen,
        "frozenPrerequisiteHash": canonical_hash(frozen)}
