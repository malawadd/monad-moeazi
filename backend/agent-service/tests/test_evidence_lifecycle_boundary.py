from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from importlib.resources import files
from pathlib import Path

import pytest
from pydantic import ValidationError

from moeazi_agent.evidence_lifecycle_contracts import (
    CopyDispositionReceipt, LifecycleScope,
)
from moeazi_agent.evidence_lifecycle_deletion import (
    LifecycleTombstone, aggregate_deletion, digest, validate_restore,
)
from moeazi_agent.evidence_lifecycle_evaluator import evaluate_persistence
from moeazi_agent.evidence_lifecycle_registry import SINK_OWNERS, policy_for, registry_hash
from moeazi_agent.evidence_lifecycle_scenarios import evaluate_lifecycle_fixture
from moeazi_agent.evidence_lifecycle_sink_discovery import (
    assert_discovered_coverage, discover_files, discover_source, load_sink_inventory,
)
from moeazi_agent.evidence_lifecycle_storage import EvidenceLifecycleRepository
from moeazi_agent.test_center import registry_response, run_fixture

NOW = datetime(2026, 8, 6, tzinfo=timezone.utc)
SCHEDULE = "d" * 64
PUBLIC = LifecycleScope(kind="public", key="public")
BASE = {"evidence_id": "evt_fixture_001", "source": "gdelt",
    "reference": "urn:fixture:one", "observed_at": NOW.isoformat(),
    "content_hash": "a" * 64, "content": "Market fixture", "market": "BTC"}


def evaluate(payload=None, sink="timescale.evidence_body", key="fixture:one"):
    return evaluate_persistence(producer="push_evidence", purpose="evidence_ingest",
        sink=sink, scope=PUBLIC, payload=payload or BASE,
        idempotency_key=key, observed_at=NOW)


def copy_receipt(copy_id: str, status: str, revision=1, predecessor=None):
    body = {"artifact_id": "artifact-fixture", "scope_key": "public",
        "schedule_hash": SCHEDULE,
        "copy_id": copy_id,
        "owner_id": SINK_OWNERS[copy_id],
        "revision": revision, "predecessor_hash": predecessor, "status": status,
        "evidence_reference": "synthetic_fixture",
        "observed_at": NOW.isoformat().replace("+00:00", "Z")}
    receipt_hash = digest(body)
    return CopyDispositionReceipt.model_validate({**body,
        "receipt_id": f"ecd_{receipt_hash[:48]}", "receipt_hash": receipt_hash})


def test_policy_and_decision_are_deterministic_and_float_free():
    first, payload, receipts, schedule = evaluate()
    second, payload_two, receipts_two, schedule_two = evaluate()
    assert first.decision_hash == second.decision_hash
    assert first.outcome == "transformed"
    assert payload == payload_two == BASE
    assert [r.receipt_hash for r in receipts] == [r.receipt_hash for r in receipts_two]
    assert schedule.schedule_hash == schedule_two.schedule_hash
    finite, *_ = evaluate({**BASE, "content": 1.2})
    assert finite.outcome in {"allow", "transformed"}
    invalid, *_ = evaluate({**BASE, "content": float("nan")})
    assert invalid.outcome == "block" and invalid.reasons == ["invalid_payload"]


@pytest.mark.parametrize("value", [
    "sk-synthetic-fixture-secret-123456", "private key: synthetic",
    "0x" + "a" * 64,
])
def test_prohibited_content_is_blocked_without_fingerprint(value):
    decision, payload, receipts, schedule = evaluate({**BASE, "content": value})
    assert decision.outcome == "block"
    assert decision.reasons == ["prohibited_content"]
    assert not payload and not receipts and schedule is None
    assert value not in decision.model_dump_json()


def test_unknown_fields_sinks_and_scope_fail_closed():
    decision, *_ = evaluate({**BASE, "caller_ttl": 10})
    assert decision.outcome == "block" and decision.reasons == ["unknown_field"]
    unknown, *_ = evaluate_persistence(producer="push_evidence", purpose="evidence_ingest",
        sink="caller.raw_sink", scope=PUBLIC, payload=BASE,
        idempotency_key="fixture:unknown", observed_at=NOW)
    assert unknown.outcome == "block" and unknown.reasons == ["unknown_sink"]
    with pytest.raises(ValidationError):
        LifecycleScope(kind="account", key="account:a", strategy_account_id="b")


def test_explicit_route_matrix_and_external_prompt_contract():
    invalid, *_ = evaluate(sink="provider.model_request")
    assert invalid.outcome == "block"
    decision, payload, receipts, schedule = evaluate_persistence(
        producer="provider_prompt", purpose="agent_analysis", sink="provider.model_request",
        scope=PUBLIC, payload={"request_id": "request-fixture", "market": "BTC",
            "content": "bounded", "evidence_ids": ["evt_fixture_001"]},
        artifact_id="request-fixture", idempotency_key="fixture:provider", observed_at=NOW)
    assert decision.outcome == "transformed"
    assert payload["content"] == "bounded"
    assert schedule.artifact_id == "request-fixture"


@pytest.mark.parametrize("alias", ["apiKey", "authorizationToken", "privateKey", "walletKey"])
def test_recursive_alias_fuzz_blocks_nested_secrets(alias):
    decision, *_ = evaluate_persistence(producer="analysis_archive", purpose="agent_analysis",
        sink="timescale.analysis_body", scope=PUBLIC,
        payload={"analysis_id": "analysis-fixture", "market": "BTC",
            "synthesis": {alias: "synthetic"}, "reports": [], "calls": []},
        artifact_id="analysis-fixture", idempotency_key=f"fixture:{alias}", observed_at=NOW)
    assert decision.outcome == "block" and decision.reasons == ["prohibited_content"]


def test_deletion_never_calls_provider_or_public_chain_verified():
    provider_policy = policy_for("provider_prompt", "agent_analysis", "provider.model_request")
    provider = aggregate_deletion("artifact-fixture", provider_policy.policy_hash, SCHEDULE, [
            copy_receipt("timescale.lifecycle_receipt", "verified_logical"),
            copy_receipt("provider.model_request", "provider_reported")], NOW)
    assert provider.outcome == "unverifiable" and provider.reason_codes == ["copy_unverifiable"]
    chain_policy = policy_for("lifecycle_control", "deletion", "onchain.public_reference")
    chain = aggregate_deletion("artifact-fixture", chain_policy.policy_hash, SCHEDULE, [
            copy_receipt("timescale.lifecycle_receipt", "verified_logical"),
            copy_receipt("onchain.public_reference", "public_onchain")], NOW)
    assert chain.outcome == "unverifiable"
    assert chain.reason_codes == ["public_onchain_non_erasable"]


def test_late_or_forked_copy_receipts_do_not_advance_aggregate():
    first = copy_receipt("timescale.evidence_body", "pending")
    fork = copy_receipt("timescale.evidence_body", "verified_physical", 3, "f" * 64)
    policy = policy_for("push_evidence", "evidence_ingest", "timescale.evidence_body")
    result = aggregate_deletion("artifact-fixture", policy.policy_hash, SCHEDULE,
        [copy_receipt("timescale.lifecycle_receipt", "verified_logical"), first, fork], NOW)
    assert result.outcome == "partial"


def test_wrong_owner_and_unattested_completion_cannot_verify_deletion():
    policy = policy_for("push_evidence", "evidence_ingest", "timescale.evidence_body")
    wrong = copy_receipt("timescale.evidence_body", "verified_logical").model_copy(
        update={"owner_id": "external_provider"})
    physical = copy_receipt("timescale.lifecycle_receipt", "verified_physical")
    result = aggregate_deletion(
        "artifact-fixture", policy.policy_hash, SCHEDULE, [wrong, physical], NOW)
    assert result.outcome != "verified"


def test_deleted_restore_is_quarantined_and_tombstone_has_no_body():
    body = {"artifact_id": "artifact-fixture", "scope_key": "public",
        "copy_id": "timescale.evidence_body",
        "cutoff_at": NOW.isoformat(), "policy_hash": "a" * 64,
        "inventory_hash": "b" * 64, "copy_receipt_hash": "c" * 64,
        "body_present": False}
    tombstone_hash = digest(body)
    tombstone = LifecycleTombstone.model_validate({**body,
        "tombstone_id": f"elt_{tombstone_hash[:48]}", "tombstone_hash": tombstone_hash})
    result = validate_restore(artifact_id="artifact-fixture", current_policy_hash="a" * 64,
        restored_policy_hash="a" * 64, inventory_hash="b" * 64, tombstone=tombstone,
        scope_matches=True, evaluated_at=NOW)
    assert result.outcome == "quarantine" and result.reason_codes == ["deleted_body"]
    assert "body" not in tombstone.model_dump(exclude={"body_present"})


def test_expiry_and_policy_windows_are_registry_owned():
    decision, _, _, schedule = evaluate()
    assert decision.expires_at - NOW == timedelta(seconds=300)
    assert schedule.body_expires_at - NOW == timedelta(days=7)
    assert policy_for("push_evidence", "evidence_ingest", "timescale.evidence_body")
    assert len(registry_hash()) == 64


def test_test_center_runs_verified_lifecycle_fixtures_only_in_isolated_surface():
    registry = registry_response()
    feature = next(item for item in registry["features"]
        if item["id"] == "evidence-lifecycle-boundary")
    assert feature["availability"] == "available"
    assert feature["defaultMode"] == "off"
    assert feature["productAvailability"] == "unavailable"
    assert feature["testCenter"] == "Isolated enforce"
    assert feature["audit"] == "Reviewed — findings deferred"
    scenario_ids = {item["id"] for item in registry["scenarios"]
        if item["featureId"] == "evidence-lifecycle-boundary"}
    assert "lifecycle-nested-secret-blocked" in scenario_ids
    result = run_fixture("lifecycle-nested-secret-blocked", "enforce", NOW,
        "evidence-lifecycle-boundary", "a" * 64)
    assert result["invariantVerdict"] == "pass" and result["actualOutcome"] == "block"
    with pytest.raises(ValueError, match="Unknown"):
        run_fixture("caller-fixture", "enforce", NOW, "evidence-lifecycle-boundary")


def test_all_checked_in_lifecycle_scenarios_pass():
    source = json.loads(files("moeazi_agent").joinpath(
        "evidence_lifecycle_scenarios.json").read_text(encoding="utf-8"))
    results = [evaluate_lifecycle_fixture(item, "observe", NOW)
        for item in source["scenarios"]]
    assert len(results) >= 11
    assert all(item["invariantVerdict"] == "pass" for item in results)
    assert any(item["baselineOutcome"] != item["candidateOutcome"] for item in results)


def test_checked_in_active_sink_inventory_is_closed():
    package = files("moeazi_agent")
    inventory = load_sink_inventory(Path(str(package.joinpath(
        "evidence_lifecycle_sink_inventory.json"))))
    assert inventory["schemaVersion"] == 5
    ids = [item["id"] for item in inventory["sinks"]]
    assert len(ids) == len(set(ids)) >= 10
    for item in inventory["sinks"]:
        source = package.joinpath(item["file"]).read_text(encoding="utf-8")
        assert item["required"] in source, item["id"]
    storage_source = package.joinpath("storage.py").read_text(encoding="utf-8")
    assert "Raw evidence persistence is disabled" in storage_source
    calls = discover_files(Path(str(package)))
    assert_discovered_coverage(calls, inventory)


def test_ast_discovery_finds_sink_even_when_marker_and_registry_are_both_omitted():
    calls = discover_source("async def leak(redis):\n await redis.publish('x', 'raw')\n",
        "omitted.py")
    assert calls[0].kind == "redis_write" and calls[0].callee == "publish"
    with pytest.raises(AssertionError, match="unreviewed"):
        assert_discovered_coverage(calls, {})


def test_new_retention_schedule_uses_transactional_retryable_outbox():
    package = files("moeazi_agent")
    storage = package.joinpath("evidence_lifecycle_storage.py").read_text(encoding="utf-8")
    workflow = package.joinpath("evidence_lifecycle_workflow.py").read_text(encoding="utf-8")
    bundle = storage[storage.index("async def _save_bundle"):
        storage.index("async def save_governed_evidence")]
    assert bundle.index("INSERT INTO evidence_retention_schedules") < \
        bundle.index("INSERT INTO evidence_lifecycle_outbox")
    assert "start_child_workflow" in workflow
    assert "WorkflowAlreadyStartedError" in workflow


@pytest.mark.asyncio
async def test_copy_receipt_identical_retry_returns_before_revision_check():
    receipt = copy_receipt("timescale.evidence_body", "pending")
    stored = receipt.model_dump(mode="json")
    class Result:
        def scalar_one_or_none(self): return stored
    class Conn:
        calls = 0
        async def execute(self, *_args, **_kwargs):
            self.calls += 1
            return Result()
    class Context:
        conn = Conn()
        async def __aenter__(self): return self.conn
        async def __aexit__(self, *_args): return False
    class Engine:
        context = Context()
        def begin(self): return self.context
    repository = EvidenceLifecycleRepository(Engine())
    await repository.append_copy_receipt(stored)
    # The artifact-scoped transaction lock precedes the idempotent replay lookup.
    assert Engine.context.conn.calls == 2
