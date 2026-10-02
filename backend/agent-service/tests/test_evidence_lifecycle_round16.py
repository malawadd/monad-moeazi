from __future__ import annotations

import json
from pathlib import Path

import pytest

from moeazi_agent.evidence_lifecycle_sink_discovery import load_sink_inventory
from moeazi_agent.dependency_safety_reasons import reconstruct_safety_reason_codes


PARTS = ["evidence_lifecycle_provider_callsites.json",
    "evidence_lifecycle_provider_callsites_02.json"]
PROVIDER = {"fingerprint": "a" * 64, "file": "fixture.py", "function": "call",
    "callee": "post", "policyRoute": "reviewed_exemption/fixture"}


def fixture(tmp_path):
    manifest = {"schemaVersion": 5,
        "sinks": [{"id": "fixture", "file": "fixture.py", "required": "gate"}],
        "pythonRoot": "fixture", "pythonGroups": [{"kind": "provider_boundary"}],
        "typescriptRoots": [], "typescriptGroups": [{"kind": "convex_write"}],
        "providerCallsiteFiles": PARTS}
    path = tmp_path / "evidence_lifecycle_sink_inventory.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    for index, name in enumerate(PARTS):
        (tmp_path / name).write_text(json.dumps({"schemaVersion": 1,
            "providerCallsites": [PROVIDER] if index == 0 else []}), encoding="utf-8")
    return path, manifest


def test_v5_inventory_honest_exact_multipart_closure(tmp_path):
    path, _ = fixture(tmp_path)
    loaded = load_sink_inventory(path)
    assert loaded["schemaVersion"] == 5 and loaded["providerCallsites"] == [PROVIDER]
    assert "providerCallsiteFiles" not in loaded


def test_safety_display_reasons_are_reconstructed_enums_not_owner_text():
    result = reconstruct_safety_reason_codes(
        ["open:convex_product_state:context_unavailable"], ["convex_product_state"])
    assert result == [{"code": "dependency_open",
        "dependency_id": "convex_product_state"}]
    assert "context_unavailable" not in json.dumps(result)
    with pytest.raises(ValueError, match="not registered"):
        reconstruct_safety_reason_codes(
            ["open:convex_product_state:confidential_marker_do_not_emit"],
            ["convex_product_state"])


def test_all_sse_outputs_use_fixed_fields_or_governed_durable_reconstruction():
    root = Path(__file__).resolve().parents[2] / "agent-service/src/moeazi_agent"
    safety = (root / "dependency_safety_stream.py").read_text(encoding="utf-8")
    monitoring = (root / "monitoring_stream.py").read_text(encoding="utf-8")
    evaluation = (root / "evaluation_api.py").read_text(encoding="utf-8")
    center = (root / "test_center_api.py").read_text(encoding="utf-8")
    assert '"reason_codes": display_reasons' in safety
    assert '"reasons": decision.reasons' not in safety
    assert "lifecycle.stream_trace_body" in monitoring
    evaluation_stream = evaluation[evaluation.index("async def stream("):]
    assert all(field in evaluation_stream for field in (
        '"status"', '"actualCostMicrousd"', '"runCount"'))
    assert 'json.dumps(row)' not in evaluation_stream
    assert '"eventType": layer_events[layer]' in center
    assert '"reason"' not in center[center.index("layer_events ="):center.index("payload = {")]


@pytest.mark.parametrize("defect", ["missing", "malformed", "duplicate_key",
    "duplicate_part", "extra_file", "extra_main", "extra_part", "sink_id", "python_group",
    "typescript_group", "logical_cross_part", "fingerprint_cross_part"])
def test_v5_inventory_rejects_all_ambiguous_or_duplicate_inputs(tmp_path, defect):
    path, manifest = fixture(tmp_path)
    first, second = (tmp_path / name for name in PARTS)
    if defect == "missing": second.unlink()
    elif defect == "malformed": second.write_text("{", encoding="utf-8")
    elif defect == "duplicate_key":
        path.write_text(path.read_text(encoding="utf-8").replace(
            '"schemaVersion": 5', '"schemaVersion": 5, "schemaVersion": 5'),
            encoding="utf-8")
    elif defect == "duplicate_part":
        manifest["providerCallsiteFiles"] = [PARTS[0], PARTS[0]]
        path.write_text(json.dumps(manifest), encoding="utf-8")
    elif defect == "extra_file":
        (tmp_path / "evidence_lifecycle_provider_callsites_03.json").write_text(
            json.dumps({"schemaVersion": 1, "providerCallsites": []}), encoding="utf-8")
    elif defect == "extra_main":
        manifest["unknown"] = True; path.write_text(json.dumps(manifest), encoding="utf-8")
    elif defect == "extra_part":
        second.write_text(json.dumps({"schemaVersion": 1,
            "providerCallsites": [], "unknown": True}), encoding="utf-8")
    elif defect == "sink_id":
        manifest["sinks"] *= 2; path.write_text(json.dumps(manifest), encoding="utf-8")
    elif defect == "python_group":
        manifest["pythonGroups"] *= 2; path.write_text(json.dumps(manifest), encoding="utf-8")
    elif defect == "typescript_group":
        manifest["typescriptGroups"] *= 2; path.write_text(json.dumps(manifest), encoding="utf-8")
    elif defect == "logical_cross_part":
        second.write_text(json.dumps({"schemaVersion": 1,
            "providerCallsites": [PROVIDER]}), encoding="utf-8")
    elif defect == "fingerprint_cross_part":
        second.write_text(json.dumps({"schemaVersion": 1,
            "providerCallsites": [{**PROVIDER, "file": "other.py"}]}), encoding="utf-8")
    with pytest.raises((ValueError, FileNotFoundError, json.JSONDecodeError)):
        load_sink_inventory(path)
