from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from importlib.resources import files
from typing import Any, Literal

from pydantic import Field, model_validator

from .contracts import StrictModel
from .dependency_safety_contracts import canonical_json
from .test_center_common import sanitize_artifact
from .test_center_fixtures import (
    registry_response as fixture_registry_response,
    run_fixture as evaluate_test_center_fixture,
)
from .test_center_public import public_audit_snapshot
from .test_center_storage import TestCenterRepository

CONTROL_TTL_SECONDS = 2 * 60 * 60
SAFE_LAYERS = ("capture", "evaluate", "project", "enforce")
HASH_PATTERN = re.compile(r"^[a-f0-9]{64}$")
FEATURE_1 = "dependency-safety-envelope"
FEATURE_2 = "cross-state-recovery-continuity"


def feature_entry(feature_id: str) -> dict | None:
    registry = load_json("feature_registry.json")
    return next((item for item in registry["features"] if item["id"] == feature_id), None)


def feature_is_testable(feature: dict | None) -> bool:
    return bool(feature and feature.get("availability") == "available"
        and feature.get("implementation") == "Implemented"
        and feature.get("implementationVerification") == "PASS"
        and feature.get("testCenter") in {"Observe", "Isolated enforce"})


def feature_testable(feature_id: str) -> bool:
    return feature_is_testable(feature_entry(feature_id))


def audit_snapshot(feature_id: str) -> dict:
    feature = feature_entry(feature_id)
    if not feature:
        raise ValueError("Unknown Test Center feature")
    return public_audit_snapshot(feature)


def feature_dependencies(feature_id: str) -> list[str]:
    feature = feature_entry(feature_id)
    return sorted(feature.get("dependencies", [])) if feature else []


def feature_ancestry(feature_id: str) -> list[str]:
    """Deterministic transitive prerequisite closure, parents before dependants."""
    registry = load_json("feature_registry.json")
    order = {item["id"]: item["order"] for item in registry["features"]}
    seen: set[str] = set()
    def visit(item: str):
        for dependency in sorted(feature_dependencies(item), key=order.__getitem__):
            if dependency not in seen:
                visit(dependency); seen.add(dependency)
    visit(feature_id)
    return sorted(seen, key=order.__getitem__)


class ControlUpdate(StrictModel):
    feature_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,79}$")
    registry_version: str = Field(min_length=8, max_length=80)
    registry_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    expected_revision: int = Field(ge=0)
    mode: Literal["off", "observe", "enforce"]
    layers: list[Literal["capture", "evaluate", "project", "enforce"]] = Field(max_length=4)

    @model_validator(mode="after")
    def safe_layers(self):
        if len(set(self.layers)) != len(self.layers):
            raise ValueError("Test Center layers must be unique")
        expected = list(SAFE_LAYERS)
        if self.mode == "off" and self.layers != []:
            raise ValueError("Off mode requires no layers")
        if self.mode == "observe" and (not self.layers or self.layers != expected[:len(self.layers)]):
            raise ValueError("Observe layers must be a dependency-closed prefix")
        if self.mode == "enforce" and self.layers != expected:
            raise ValueError("Enforce mode requires all four dependency-closed layers")
        return self


class RunRequest(StrictModel):
    feature_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,79}$")
    scenario_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,79}$")
    control_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    idempotency_key: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9._:-]+$")
    request_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    prerequisite_run_ids: dict[str, str] | None = None


def load_json(name: str) -> dict:
    return json.loads(files("moeazi_agent").joinpath(name).read_text(encoding="utf-8"))


def canonical_hash(value: Any) -> str:
    return sha256(canonical_json(value)).hexdigest()


def safe_default_state(feature_id: str = "dependency-safety-envelope") -> dict:
    meta = load_json("feature_registry_meta.json")
    testable = feature_testable(feature_id)
    value = {
        "featureId": feature_id, "registryVersion": meta["registryVersion"],
        "registryHash": meta["registryHash"],
        "revision": 0, "requestedMode": "off" if testable else "unavailable",
        "effectiveMode": "off" if testable else "unavailable", "layers": [],
        "manualGuard": True, "liteMode": True, "expiresAt": None,
        "prerequisiteBindings": [],
    }
    return {**value, "controlHash": canonical_hash(value)}


def operator_test_id(subject: str, session_id: str) -> str:
    return f"operator_{sha256(f'{subject}:{session_id}'.encode()).hexdigest()[:32]}"


def controls_key(operator_id: str, feature_id: str) -> str:
    return f"moeazi:test-center:controls:v2:{operator_id}:{feature_id}"


def valid_controls(value: object, feature_id: str) -> dict | None:
    if not feature_testable(feature_id):
        return None
    meta = load_json("feature_registry_meta.json")
    keys = {"featureId", "registryVersion", "registryHash", "revision", "requestedMode",
        "effectiveMode", "layers", "manualGuard", "liteMode", "expiresAt",
        "prerequisiteBindings", "controlHash"}
    if not isinstance(value, dict) or set(value) != keys:
        return None
    if value["featureId"] != feature_id or value["registryVersion"] != meta["registryVersion"] \
            or value["registryHash"] != meta["registryHash"]:
        return None
    if value["requestedMode"] not in {"off", "observe", "enforce"} \
            or value["effectiveMode"] != value["requestedMode"]:
        return None
    if type(value["revision"]) is not int or value["revision"] < 1 \
            or value["manualGuard"] is not True or value["liteMode"] is not True:
        return None
    expires = value["expiresAt"]
    if type(expires) is not int or expires <= int(datetime.now(timezone.utc).timestamp()):
        return None
    try:
        ControlUpdate(feature_id=feature_id, registry_version=value["registryVersion"],
            registry_hash=value["registryHash"], expected_revision=value["revision"],
            mode=value["effectiveMode"], layers=value["layers"])
    except Exception:
        return None
    bindings = value["prerequisiteBindings"]
    if not isinstance(bindings, list):
        return None
    dependencies = feature_dependencies(feature_id) if value["effectiveMode"] != "off" else []
    if dependencies:
        expected_keys = {"featureId", "revision", "registryHash", "controlHash"}
        if len(bindings) != len(dependencies) or any(
                set(binding) != expected_keys for binding in bindings): return None
        by_feature = {binding["featureId"]: binding for binding in bindings}
        if set(by_feature) != set(dependencies): return None
        for bound in by_feature.values():
            if type(bound["revision"]) is not int or bound["revision"] < 1 \
                    or bound["registryHash"] != meta["registryHash"] \
                    or not isinstance(bound["controlHash"], str) \
                    or not HASH_PATTERN.fullmatch(bound["controlHash"]): return None
    elif bindings:
        return None
    unsigned = {key: value[key] for key in keys if key != "controlHash"}
    return value if value["controlHash"] == canonical_hash(unsigned) else None


async def get_controls(redis, operator_id: str, feature_id: str) -> dict:
    if not feature_testable(feature_id):
        return safe_default_state(feature_id)
    try:
        raw = await redis.get(controls_key(operator_id, feature_id))
        parsed = json.loads(raw) if raw else None
        return valid_controls(parsed, feature_id) or safe_default_state(feature_id)
    except Exception:
        return safe_default_state(feature_id)


def prerequisite_ready(prerequisite: dict, mode: str) -> bool:
    required_mode = {"observe", "enforce"} if mode == "observe" else {"enforce"}
    needed = {"capture", "evaluate", "project"} if mode == "observe" else set(SAFE_LAYERS)
    return prerequisite["effectiveMode"] in required_mode and needed.issubset(prerequisite["layers"])


async def cas_controls(redis, operator_id: str, update: ControlUpdate) -> dict:
    meta = load_json("feature_registry_meta.json")
    if update.registry_version != meta["registryVersion"] or update.registry_hash != meta["registryHash"]:
        raise RuntimeError("Test Center registry binding changed")
    registry = load_json("feature_registry.json")
    feature = next((item for item in registry["features"] if item["id"] == update.feature_id), None)
    if not feature_is_testable(feature):
        raise RuntimeError("Test Center feature is unavailable")
    requested_layers = set(update.layers)
    for layer in requested_layers:
        expected = "isolated-test-center" if layer == "enforce" else "available"
        if feature["layers"].get(layer) != expected:
            raise RuntimeError("Requested Test Center layer is unavailable")
    prerequisites = []
    if update.mode != "off":
        for prerequisite_id in feature_dependencies(update.feature_id):
            prerequisite = await get_controls(redis, operator_id, prerequisite_id)
            if not prerequisite_ready(prerequisite, update.mode):
                raise RuntimeError(f"Test Center prerequisite {prerequisite_id} is not effective through required layers")
            prerequisites.append(prerequisite)
    previous = await get_controls(redis, operator_id, update.feature_id)
    revision = update.expected_revision + 1
    value = {
        "featureId": update.feature_id, "registryVersion": update.registry_version,
        "registryHash": update.registry_hash, "revision": revision,
        "requestedMode": update.mode, "effectiveMode": update.mode,
        "layers": list(update.layers),
        "manualGuard": True, "liteMode": True,
        "expiresAt": int((datetime.now(timezone.utc) + timedelta(seconds=CONTROL_TTL_SECONDS)).timestamp()),
        "prerequisiteBindings": [{"featureId": prerequisite["featureId"],
            "revision": prerequisite["revision"], "registryHash": prerequisite["registryHash"],
            "controlHash": prerequisite["controlHash"]} for prerequisite in prerequisites],
    }
    value["controlHash"] = canonical_hash(value)
    script = """
local current = redis.call('GET', KEYS[1])
local revision = 0
if current then revision = tonumber(cjson.decode(current)['revision']) end
if revision ~= tonumber(ARGV[1]) then return 0 end
local now = tonumber(ARGV[4])
local required_mode = ARGV[5]
for key_index = 2, #KEYS do
  local prerequisite = redis.call('GET', KEYS[key_index])
  if not prerequisite then return -1 end
  prerequisite = cjson.decode(prerequisite)
  local offset = 6 + ((key_index - 2) * 3)
  if prerequisite['controlHash'] ~= ARGV[offset] or
      tonumber(prerequisite['revision']) ~= tonumber(ARGV[offset + 1]) or
      prerequisite['registryHash'] ~= ARGV[offset + 2] or
      tonumber(prerequisite['expiresAt']) <= now then return -1 end
  local layer_set = {}
  for _, layer in ipairs(prerequisite['layers']) do layer_set[layer] = true end
  if not layer_set['capture'] or not layer_set['evaluate'] or not layer_set['project'] then return -1 end
  if required_mode == 'enforce' then
    if prerequisite['effectiveMode'] ~= 'enforce' or not layer_set['enforce'] then return -1 end
  elseif prerequisite['effectiveMode'] ~= 'observe' and prerequisite['effectiveMode'] ~= 'enforce' then
    return -1
  end
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
"""
    dependency_keys = [controls_key(operator_id, item["featureId"])
        for item in value["prerequisiteBindings"]]
    dependency_args = [part for item in value["prerequisiteBindings"]
        for part in (item["controlHash"], item["revision"], item["registryHash"])]
    changed = await redis.eval(
        script, 1 + len(dependency_keys), controls_key(operator_id, update.feature_id), *dependency_keys,
        update.expected_revision, json.dumps(value, sort_keys=True, separators=(",", ":")),
        CONTROL_TTL_SECONDS, int(datetime.now(timezone.utc).timestamp()), update.mode,
        *dependency_args,
    )
    if changed == -1:
        raise RuntimeError("Test Center prerequisite changed during control update")
    if changed != 1:
        raise RuntimeError("Test Center control revision conflict")
    return {"previous": previous, "current": value}


async def freeze_control_snapshot(redis, operator_id: str, feature_id: str,
                                  expected_hash: str) -> dict:
    from .test_center_frozen_controls import freeze_control_snapshot as freeze
    return await freeze(redis, operator_id, feature_id, expected_hash)


def registry_response() -> dict:
    return fixture_registry_response()


def run_fixture(scenario_id: str, mode: str, now: datetime,
                feature_id: str = FEATURE_1, control_hash: str | None = None) -> dict:
    if not feature_testable(feature_id):
        raise ValueError("Test Center feature is unavailable")
    return evaluate_test_center_fixture(scenario_id, mode, now, feature_id,
        control_hash, canonical_hash)
